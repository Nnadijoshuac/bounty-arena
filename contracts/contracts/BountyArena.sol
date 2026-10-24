// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Bounty Arena
/// @notice Escrow, verification and payouts for USDC work where humans and AI agents compete.
///         Posters escrow USDC. Hunters commit to a deliverable, then reveal it, so nobody can copy
///         a published answer into an earlier slot. Winners are picked by the poster or, on verified
///         bounties, by a machine check: the first revealed entry that passes is paid at once.
///         A ghosting poster cannot keep the money: after review the escrow splits across the
///         entries the poster did not reject. If nobody submits, the poster gets a refund.
/// @dev    All accounting goes through the USDC ERC-20 interface (6 decimals), never msg.value.
///         Payouts are credited to `claimable` and pulled with `withdraw`, so one blocklisted
///         address can never block a payout to everyone else.
///         The owner can tune fees and windows for future bounties. There is no function that
///         moves escrowed funds to the owner, the treasury, the arbiter or the verifier.
contract BountyArena is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------ types

    enum Mode {
        WinnerTakesAll,
        Top3Split,
        FirstValid,
        Verified // a machine check decides, the first passing entry is paid instantly
    }

    enum Category {
        Code,
        Research,
        Design,
        Data,
        Content
    }

    enum Status {
        Open, // taking submissions until the deadline, then in review until reviewEnd
        Awarded, // winners picked, dispute window running
        Disputed, // poster-judged bounty frozen until the arbiter rules (or times out)
        Paid, // winners credited
        GhostPaid, // poster missed the review window, unrejected entries split the escrow
        Refunded // nobody submitted, nobody passed, or the arbiter ruled for the poster
    }

    /// @dev Per-entry challenge of a failed check on a verified bounty. Does not freeze the bounty.
    enum Challenge {
        None,
        Open,
        Upheld,
        Dismissed,
        Expired
    }

    struct Bounty {
        address poster;
        address arbiter; // snapshot at creation
        address verifier; // snapshot at creation, only used by verified bounties
        address disputer; // last bounty-level disputer (poster-judged modes)
        uint128 reward; // escrowed USDC, 6 decimals
        uint128 bond; // dispute bonds currently held for this bounty
        uint128 bondSize; // dispute bond snapshot at creation
        uint128 entryStake; // USDC each entrant puts down (0 for none)
        uint128 stakeHeld; // entry stakes currently held for this bounty
        uint64 createdAt;
        uint64 deadline;
        uint64 reviewEnd; // award deadline, or deadline + verify grace on verified bounties
        uint64 awardedAt;
        uint64 disputedAt;
        uint64 featuredUntil;
        uint64 settledAt;
        uint64 lastJudgedAt; // latest rejection or failed check, each opens a dispute window
        uint32 disputeWindow; // snapshot at creation
        uint16 feeBps; // snapshot at creation
        uint8 maxEntries; // 1..50, set by the poster
        uint8 openChallenges; // verified: challenges waiting on the arbiter
        Mode mode;
        Category category;
        Status status;
        bytes32 specHash; // keccak256 of the spec text, or an IPFS digest
        bytes32 checkHash; // verified bounties: keccak256 of the machine check
        string title;
    }

    struct Submission {
        address hunter;
        bytes32 commitment; // keccak256(abi.encode(bountyId, hunter, contentHash, salt))
        bytes32 deliverableHash; // contentHash, set on reveal
        uint64 submittedAt;
        bool isAgent;
        bool revealed;
        bool rejected; // poster-judged: turned down by the poster
        uint8 rank; // 1..3 once awarded, 0 otherwise
        uint128 payout; // net amount credited once settled
        bool checked; // verified: the verifier posted a result
        bool passed;
        bool stakeSettled;
        Challenge challenge;
        uint64 judgedAt; // when it was rejected or checked
        uint64 challengedAt;
        bytes32 reportHash; // keccak256 of the verifier's report
    }

    struct Stats {
        string handle;
        bool registered;
        bool isAgent;
        uint32 submissions;
        uint32 wins;
        uint32 bountiesPosted;
        uint128 earned; // net bounty payouts, tips excluded
        uint128 tipsReceived;
        uint128 posted; // USDC escrowed as a poster
        uint32[5] categoryWins;
    }

    /// @dev Optional terms a poster sets at creation. Grouped to keep the stack small.
    struct Terms {
        uint32 featureDays;
        uint128 maxFeaturePrice; // reverts if the current price per day is higher
        uint128 entryStake;
        uint8 maxEntries; // 0 means MAX_SUBMISSIONS
    }

    // ------------------------------------------------------------------ constants

    uint16 public constant MAX_FEE_BPS = 1_000; // fee can never exceed 10%
    uint16 public constant MAX_STAKE_BPS = 1_000; // an entry stake can never exceed 10% of the reward
    uint128 public constant MIN_REWARD = 1e6; // 1 USDC, keeps spam bounties out
    uint128 public constant MAX_DISPUTE_BOND = 1_000e6;
    uint128 public constant MAX_ENTRY_STAKE = 100e6;
    uint128 public constant MAX_FEATURED_PRICE = 1_000e6; // per day
    uint64 public constant MIN_DURATION = 1 hours;
    uint64 public constant MAX_DURATION = 90 days;
    uint64 public constant REVEAL_WINDOW = 10 minutes;
    uint64 public constant ARBITER_TIMEOUT = 14 days;
    uint64 public constant VERIFIER_TIMEOUT = 14 days;
    uint256 public constant MAX_SUBMISSIONS = 50;
    uint256 public constant MAX_FEATURE_DAYS = 30;

    // ------------------------------------------------------------------ state

    IERC20 public immutable usdc;

    address public treasury;
    address public arbiter;
    address public verifier;
    uint16 public feeBps = 500; // 5% of every payout
    uint32 public reviewWindow = 3 days;
    uint32 public disputeWindow = 2 days;
    uint32 public verifyGrace = 1 hours;
    uint128 public featuredPricePerDay = 10e6;
    uint128 public disputeBond = 5e6;

    uint256 public feesAccrued;

    Bounty[] internal _bounties;
    mapping(uint256 => Submission[]) internal _submissions;
    mapping(uint256 => mapping(address => bool)) public hasSubmitted;
    mapping(uint256 => mapping(bytes32 => bool)) public contentUsed;
    mapping(address => uint256) public claimable;
    mapping(address => Stats) internal _stats;
    address[] internal _hunters;

    // ------------------------------------------------------------------ events

    event Registered(address indexed account, string handle, bool isAgent);
    event BountyCreated(
        uint256 indexed id,
        address indexed poster,
        uint128 reward,
        uint64 deadline,
        Category category,
        Mode mode,
        bytes32 specHash
    );
    event Featured(uint256 indexed id, address indexed payer, uint256 days_, uint256 cost, uint64 featuredUntil);
    event Submitted(uint256 indexed id, uint256 indexed index, address indexed hunter, bool isAgent, bytes32 commitment);
    event Revealed(uint256 indexed id, uint256 indexed index, address indexed hunter, bytes32 deliverableHash);
    event Rejected(uint256 indexed id, uint256 indexed index);
    event Checked(uint256 indexed id, uint256 indexed index, bool passed, bytes32 reportHash);
    event StakeSettled(uint256 indexed id, uint256 indexed index, address indexed to, uint128 amount, bool forfeited);
    event Awarded(uint256 indexed id, uint32[] indexes);
    event Disputed(uint256 indexed id, address indexed disputer, uint128 bond);
    event Challenged(uint256 indexed id, uint256 indexed index, address indexed hunter);
    event ChallengeResolved(uint256 indexed id, uint256 indexed index, bool upheld);
    event DisputeResolved(uint256 indexed id, uint32[] indexes, bool upheld);
    event DisputeTimedOut(uint256 indexed id, address indexed disputer, uint128 bondReturned);
    event BondSettled(uint256 indexed id, address indexed to, uint128 amount, bool forfeited);
    event WinnerPaid(uint256 indexed id, address indexed hunter, uint8 rank, uint128 amount);
    event GhostPaid(uint256 indexed id, uint256 hunters, uint128 total);
    event GhostShare(uint256 indexed id, uint256 indexed index, address indexed hunter, uint128 amount);
    event Refunded(uint256 indexed id, address indexed poster, uint128 amount);
    event Tipped(uint256 indexed id, address indexed from, address indexed hunter, uint128 net, uint128 fee);
    event Withdrawn(address indexed account, uint256 amount);
    event FeesWithdrawn(address indexed treasury, uint256 amount);
    event ConfigChanged(string key, uint256 value);
    event AddressChanged(string key, address value);

    // ------------------------------------------------------------------ errors

    error NotRegistered();
    error BadInput();
    error BadState();
    error TooEarly();
    error TooLate();
    error NotPoster();
    error NotArbiter();
    error NotVerifier();
    error NotSubmitter();
    error AlreadySubmitted();
    error FirstValidOrder();
    error PriceChanged();
    error DuplicateContent();

    constructor(IERC20 usdc_, address treasury_, address arbiter_, address verifier_) Ownable(msg.sender) {
        if (
            address(usdc_) == address(0) || treasury_ == address(0) || arbiter_ == address(0) || verifier_ == address(0)
        ) revert BadInput();
        usdc = usdc_;
        treasury = treasury_;
        arbiter = arbiter_;
        verifier = verifier_;
    }

    // ------------------------------------------------------------------ profiles

    /// @notice Set a public handle and declare yourself a human or an agent.
    ///         The agent flag locks after your first submission so leaderboards stay honest.
    function register(string calldata handle, bool isAgent) external {
        uint256 len = bytes(handle).length;
        if (len == 0 || len > 32) revert BadInput();
        Stats storage s = _stats[msg.sender];
        if (s.submissions > 0 && s.isAgent != isAgent) revert BadState();
        if (!s.registered) {
            s.registered = true;
            _hunters.push(msg.sender);
        }
        s.handle = handle;
        s.isAgent = isAgent;
        emit Registered(msg.sender, handle, isAgent);
    }

    // ------------------------------------------------------------------ posting

    /// @notice Post a bounty judged by the poster. Use createVerifiedBounty for machine-checked work.
    /// @param maxFeaturePrice highest featured price per day you accept, so a price change cannot surprise you
    /// @param entryStake optional USDC each entrant puts down, at most 10% of the reward. Rejected entries forfeit it.
    /// @param maxEntries entry cap, 1 to 50 (0 means 50)
    function createBounty(
        string calldata title,
        bytes32 specHash,
        Category category,
        Mode mode,
        uint128 reward,
        uint64 deadline,
        uint32 featureDays,
        uint128 maxFeaturePrice,
        uint128 entryStake,
        uint8 maxEntries
    ) external nonReentrant returns (uint256 id) {
        if (mode == Mode.Verified) revert BadInput();
        id = _create(title, specHash, bytes32(0), category, mode, reward, deadline, Terms(featureDays, maxFeaturePrice, entryStake, maxEntries));
    }

    /// @notice Post a verified bounty. The protocol verifier runs the check behind `checkHash`
    ///         on each revealed entry in order, and the first entry that passes is paid at once.
    ///         An optional entry stake keeps spam out: it comes back unless your entry fails the check.
    function createVerifiedBounty(
        string calldata title,
        bytes32 specHash,
        bytes32 checkHash,
        Category category,
        uint128 reward,
        uint64 deadline,
        uint32 featureDays,
        uint128 maxFeaturePrice,
        uint128 entryStake,
        uint8 maxEntries
    ) external nonReentrant returns (uint256 id) {
        if (checkHash == bytes32(0)) revert BadInput();
        id = _create(title, specHash, checkHash, category, Mode.Verified, reward, deadline, Terms(featureDays, maxFeaturePrice, entryStake, maxEntries));
    }

    function _create(
        string calldata title,
        bytes32 specHash,
        bytes32 checkHash,
        Category category,
        Mode mode,
        uint128 reward,
        uint64 deadline,
        Terms memory t
    ) internal returns (uint256 id) {
        uint256 tlen = bytes(title).length;
        if (tlen == 0 || tlen > 120 || specHash == bytes32(0)) revert BadInput();
        if (reward < MIN_REWARD) revert BadInput();
        if (deadline < block.timestamp + MIN_DURATION || deadline > block.timestamp + MAX_DURATION) revert BadInput();
        if (t.featureDays > MAX_FEATURE_DAYS) revert BadInput();
        if (t.entryStake > MAX_ENTRY_STAKE || uint256(t.entryStake) * 10_000 > uint256(reward) * MAX_STAKE_BPS) revert BadInput();
        if (t.maxEntries > MAX_SUBMISSIONS) revert BadInput();
        if (t.featureDays > 0 && featuredPricePerDay > t.maxFeaturePrice) revert PriceChanged();

        uint128 featureCost = uint128(featuredPricePerDay * t.featureDays);
        usdc.safeTransferFrom(msg.sender, address(this), uint256(reward) + featureCost);

        id = _bounties.length;
        Bounty storage b = _bounties.push();
        b.poster = msg.sender;
        b.arbiter = arbiter;
        b.verifier = verifier;
        b.reward = reward;
        b.bondSize = disputeBond;
        b.entryStake = t.entryStake;
        b.maxEntries = t.maxEntries == 0 ? uint8(MAX_SUBMISSIONS) : t.maxEntries;
        b.createdAt = uint64(block.timestamp);
        b.deadline = deadline;
        b.reviewEnd = deadline + (mode == Mode.Verified ? verifyGrace : reviewWindow);
        b.disputeWindow = disputeWindow;
        b.feeBps = feeBps;
        b.mode = mode;
        b.category = category;
        b.specHash = specHash;
        b.checkHash = checkHash;
        b.title = title;

        Stats storage s = _stats[msg.sender];
        s.bountiesPosted += 1;
        s.posted += reward;

        emit BountyCreated(id, msg.sender, reward, deadline, category, mode, specHash);

        if (t.featureDays > 0) {
            feesAccrued += featureCost;
            b.featuredUntil = uint64(block.timestamp + uint256(t.featureDays) * 1 days);
            emit Featured(id, msg.sender, t.featureDays, featureCost, b.featuredUntil);
        }
    }

    /// @notice Pay to pin an open bounty to the top of the board. The fee goes to the protocol.
    function feature(uint256 id, uint32 featureDays, uint128 maxFeaturePrice) external nonReentrant {
        Bounty storage b = _bounty(id);
        if (b.status != Status.Open || block.timestamp >= b.deadline) revert BadState();
        if (featureDays == 0 || featureDays > MAX_FEATURE_DAYS) revert BadInput();
        if (featuredPricePerDay > maxFeaturePrice) revert PriceChanged();
        uint128 cost = uint128(featuredPricePerDay * featureDays);
        usdc.safeTransferFrom(msg.sender, address(this), cost);
        feesAccrued += cost;
        uint64 start = b.featuredUntil > block.timestamp ? b.featuredUntil : uint64(block.timestamp);
        b.featuredUntil = start + uint64(featureDays) * 1 days;
        emit Featured(id, msg.sender, featureDays, cost, b.featuredUntil);
    }

    // ------------------------------------------------------------------ hunting

    /// @notice The commitment a hunter submits: binds the content to this bounty and this sender.
    function commitmentFor(uint256 id, address hunter, bytes32 contentHash, bytes32 salt) public pure returns (bytes32) {
        return keccak256(abi.encode(id, hunter, contentHash, salt));
    }

    /// @notice Step 1 of 2: enter with a commitment. Publish your text only after this is mined.
    function submit(uint256 id, bytes32 commitment) external nonReentrant returns (uint256 index) {
        Bounty storage b = _bounty(id);
        Stats storage s = _stats[msg.sender];
        if (!s.registered) revert NotRegistered();
        if (commitment == bytes32(0)) revert BadInput();
        if (b.status != Status.Open) revert BadState();
        if (block.timestamp >= b.deadline) revert TooLate();
        if (msg.sender == b.poster) revert BadInput();
        if (hasSubmitted[id][msg.sender]) revert AlreadySubmitted();
        Submission[] storage subs = _submissions[id];
        if (subs.length >= b.maxEntries) revert BadState();

        uint128 stake = b.entryStake;
        if (stake > 0) {
            usdc.safeTransferFrom(msg.sender, address(this), stake);
            b.stakeHeld += stake;
        }

        hasSubmitted[id][msg.sender] = true;
        index = subs.length;
        Submission storage sub = subs.push();
        sub.hunter = msg.sender;
        sub.commitment = commitment;
        sub.submittedAt = uint64(block.timestamp);
        sub.isAgent = s.isAgent;
        sub.stakeSettled = stake == 0;
        s.submissions += 1;
        emit Submitted(id, index, msg.sender, s.isAgent, commitment);
    }

    /// @notice Step 2 of 2: reveal the content hash and salt within REVEAL_WINDOW of entering.
    ///         The same content can only be revealed once per bounty, so a copy can never count.
    function reveal(uint256 id, uint256 index, bytes32 contentHash, bytes32 salt) external {
        _bounty(id);
        Submission[] storage subs = _submissions[id];
        if (index >= subs.length) revert BadInput();
        Submission storage s = subs[index];
        if (s.hunter != msg.sender) revert NotSubmitter();
        if (s.revealed) revert BadState();
        if (block.timestamp >= s.submittedAt + REVEAL_WINDOW) revert TooLate();
        if (contentHash == bytes32(0) || commitmentFor(id, msg.sender, contentHash, salt) != s.commitment) revert BadInput();
        if (contentUsed[id][contentHash]) revert DuplicateContent();
        contentUsed[id][contentHash] = true;
        s.revealed = true;
        s.deliverableHash = contentHash;
        emit Revealed(id, index, msg.sender, contentHash);
    }

    // ------------------------------------------------------------------ verification

    /// @notice The bounty's verifier posts the result of the machine check for one entry.
    ///         Entries are judged in order. A pass is paid at once unless an earlier entrant has an
    ///         open challenge, in which case it is paid as soon as that challenge closes.
    ///         An entry that never revealed can only be failed, once its reveal window is over.
    function verifyAndAward(uint256 id, uint256 index, bool passed, bytes32 reportHash) external nonReentrant {
        Bounty storage b = _bounty(id);
        if (msg.sender != b.verifier) revert NotVerifier();
        if (b.mode != Mode.Verified || b.status != Status.Open) revert BadState();
        if (block.timestamp >= b.reviewEnd) revert TooLate();
        if (reportHash == bytes32(0)) revert BadInput();
        Submission[] storage subs = _submissions[id];
        if (index >= subs.length) revert BadInput();
        Submission storage s = subs[index];
        if (s.checked) revert BadState();
        if (!s.revealed && (passed || block.timestamp < s.submittedAt + REVEAL_WINDOW)) revert TooEarly();
        if (passed) {
            for (uint256 i; i < index; ++i) {
                if (!subs[i].checked) revert FirstValidOrder();
            }
        }

        s.checked = true;
        s.passed = passed;
        s.reportHash = reportHash;
        s.judgedAt = uint64(block.timestamp);
        emit Checked(id, index, passed, reportHash);

        if (!passed) {
            b.lastJudgedAt = uint64(block.timestamp);
            return;
        }
        _settleVerified(id, b);
    }

    // ------------------------------------------------------------------ reviewing

    /// @notice Poster-judged bounties: turn down an entry. Rejected entries are never paid by a
    ///         ghost split or a fallback, and forfeit their stake to the protocol once their
    ///         dispute window closes. Each rejection opens its own dispute window.
    function reject(uint256 id, uint256 index) external {
        Bounty storage b = _bounty(id);
        _reject(id, b, index);
    }

    /// @notice Reject several entries in one transaction (for example a burst of spam).
    function rejectMany(uint256 id, uint32[] calldata indexes) external {
        Bounty storage b = _bounty(id);
        for (uint256 i; i < indexes.length; ++i) {
            _reject(id, b, indexes[i]);
        }
    }

    function _reject(uint256 id, Bounty storage b, uint256 index) internal {
        if (msg.sender != b.poster) revert NotPoster();
        if (b.mode == Mode.Verified || b.status != Status.Open) revert BadState();
        if (block.timestamp >= b.reviewEnd) revert TooLate();
        Submission[] storage subs = _submissions[id];
        if (index >= subs.length || subs[index].rejected) revert BadInput();
        subs[index].rejected = true;
        subs[index].judgedAt = uint64(block.timestamp);
        b.lastJudgedAt = uint64(block.timestamp);
        emit Rejected(id, index);
    }

    /// @notice Pick the winner(s). Ordered best first for top 3 split (50 / 30 / 20).
    ///         Winners must have revealed and not be rejected.
    ///         Winner-takes-all and top 3 wait for the deadline so the race stays fair.
    ///         First valid can be awarded at any time, but only to the earliest entry not rejected.
    function award(uint256 id, uint32[] calldata indexes) external {
        Bounty storage b = _bounty(id);
        if (msg.sender != b.poster) revert NotPoster();
        if (b.status != Status.Open || b.mode == Mode.Verified) revert BadState();
        if (block.timestamp >= b.reviewEnd) revert TooLate();
        if (b.mode != Mode.FirstValid && block.timestamp < b.deadline) revert TooEarly();

        Submission[] storage subs = _submissions[id];
        _checkWinners(b.mode, subs, indexes, true);

        if (b.mode == Mode.FirstValid) {
            for (uint256 i; i < indexes[0]; ++i) {
                if (!subs[i].rejected) revert FirstValidOrder();
            }
        }

        for (uint256 i; i < indexes.length; ++i) {
            subs[indexes[i]].rank = uint8(i + 1);
        }
        b.status = Status.Awarded;
        b.awardedAt = uint64(block.timestamp);
        emit Awarded(id, indexes);
    }

    /// @notice After the dispute window, anyone can release the payout to the winners.
    function finalize(uint256 id) external nonReentrant {
        Bounty storage b = _bounty(id);
        if (b.status != Status.Awarded) revert BadState();
        if (block.timestamp < b.awardedAt + b.disputeWindow) revert TooEarly();
        _payRanks(id, b);
        _releaseStakes(id, b);
    }

    /// @notice Settles a bounty nobody resolved in time. Waits for the review window and for the
    ///         dispute window of the latest rejection or failed check.
    ///         Poster-judged: the escrow splits evenly across revealed entries that were not rejected
    ///         (none means a refund). Verified: nobody passed, so the poster is refunded. If the
    ///         verifier left entries unchecked, this waits VERIFIER_TIMEOUT so they can be judged or disputed.
    function settleTimeout(uint256 id) external nonReentrant {
        Bounty storage b = _bounty(id);
        if (b.status != Status.Open) revert BadState();
        if (block.timestamp < b.reviewEnd) revert TooEarly();
        if (b.lastJudgedAt != 0 && block.timestamp < b.lastJudgedAt + b.disputeWindow) revert TooEarly();
        if (b.mode == Mode.Verified) {
            if (b.openChallenges > 0) revert TooEarly();
            if (_hasUnchecked(id) && block.timestamp < b.reviewEnd + VERIFIER_TIMEOUT) revert TooEarly();
            _refund(id, b);
        } else if (!_ghostSplit(id, b)) {
            _refund(id, b);
        }
        _releaseStakes(id, b);
    }

    /// @notice Nobody submitted. The poster takes the escrow back as soon as the deadline passes.
    function reclaim(uint256 id) external nonReentrant {
        Bounty storage b = _bounty(id);
        if (msg.sender != b.poster) revert NotPoster();
        if (b.status != Status.Open || _submissions[id].length != 0) revert BadState();
        if (block.timestamp < b.deadline) revert TooEarly();
        _refund(id, b);
    }

    /// @notice Moves one entry's stake once its fate is final: back to the entrant, or forfeited
    ///         (to the poster on a failed verified check, to the protocol on a rejection) after
    ///         that entry's dispute window. Anyone can call it.
    function settleStake(uint256 id, uint256 index) external nonReentrant {
        Bounty storage b = _bounty(id);
        Submission[] storage subs = _submissions[id];
        if (index >= subs.length) revert BadInput();
        Submission storage s = subs[index];
        if (s.stakeSettled) revert BadState();
        if (!_trySettleStake(id, index, b, s)) revert TooEarly();
    }

    // ------------------------------------------------------------------ disputes

    /// @notice Poster-judged: a submitter can challenge an award during the dispute window, or
    ///         challenge their own rejection within the dispute window that rejection opened.
    ///         This freezes the bounty until the arbiter rules.
    ///         Verified: only an entrant whose own revealed entry was judged failed can challenge,
    ///         within the dispute window from that check. It does not freeze the bounty. It only holds
    ///         back the payout of later entries until the arbiter rules.
    ///         The bond comes back whenever the arbiter upholds the dispute.
    function dispute(uint256 id) external nonReentrant {
        Bounty storage b = _bounty(id);
        if (!hasSubmitted[id][msg.sender]) revert NotSubmitter();
        (uint256 index, Submission storage s) = _entryOf(id, msg.sender);

        if (b.mode == Mode.Verified) {
            if (!s.checked || s.passed || !s.revealed || s.challenge != Challenge.None) revert BadState();
            if (block.timestamp >= s.judgedAt + b.disputeWindow) revert TooLate();
            uint128 vbond = _takeBond(b);
            s.challenge = Challenge.Open;
            s.challengedAt = uint64(block.timestamp);
            b.openChallenges += 1;
            emit Disputed(id, msg.sender, vbond);
            emit Challenged(id, index, msg.sender);
            return;
        }

        if (b.status == Status.Awarded) {
            if (block.timestamp >= b.awardedAt + b.disputeWindow) revert TooLate();
        } else if (b.status == Status.Open) {
            if (!s.rejected) revert BadState();
            if (block.timestamp >= s.judgedAt + b.disputeWindow) revert TooLate();
        } else {
            revert BadState();
        }
        uint128 bond = _takeBond(b);
        b.disputer = msg.sender;
        b.disputedAt = uint64(block.timestamp);
        b.status = Status.Disputed;
        emit Disputed(id, msg.sender, bond);
    }

    /// @notice Poster-judged: the bounty's arbiter rules. It can only move the escrow among this
    ///         bounty's revealed entrants, or back to the poster with an empty list. Never anywhere else.
    ///         The bond is returned when the ruling changes an award, or overturns the disputer's rejection.
    function resolveDispute(uint256 id, uint32[] calldata indexes) external nonReentrant {
        Bounty storage b = _bounty(id);
        if (msg.sender != b.arbiter) revert NotArbiter();
        if (b.status != Status.Disputed) revert BadState();

        Submission[] storage subs = _submissions[id];
        bool wasAwarded = b.awardedAt != 0;
        bool changed = wasAwarded && indexes.length == 0;
        if (wasAwarded && indexes.length > 0) {
            uint256 before;
            for (uint256 i; i < subs.length; ++i) {
                if (subs[i].rank != 0) before++;
            }
            changed = before != indexes.length;
            for (uint256 i; i < indexes.length && !changed; ++i) {
                if (indexes[i] >= subs.length || subs[indexes[i]].rank != i + 1) changed = true;
            }
        }
        for (uint256 i; i < subs.length; ++i) {
            subs[i].rank = 0;
        }

        bool disputerWins;
        if (indexes.length == 0) {
            _refund(id, b);
        } else {
            _checkWinners(b.mode, subs, indexes, false);
            for (uint256 i; i < indexes.length; ++i) {
                Submission storage w = subs[indexes[i]];
                w.rank = uint8(i + 1);
                w.rejected = false; // the arbiter overturned any rejection of a winner
                if (w.hunter == b.disputer) disputerWins = true;
            }
            _payRanks(id, b);
        }
        _releaseStakes(id, b);

        bool upheld = changed || disputerWins;
        _settleBond(id, b, b.disputer, upheld);
        emit DisputeResolved(id, indexes, upheld);
    }

    /// @notice Verified: the arbiter rules on a challenged check. Upheld means the entry really
    ///         passed: its stake and bond come back, and it wins if no earlier entry already won.
    function resolveChallenge(uint256 id, uint256 index, bool upheld) external nonReentrant {
        Bounty storage b = _bounty(id);
        if (msg.sender != b.arbiter) revert NotArbiter();
        Submission[] storage subs = _submissions[id];
        if (index >= subs.length) revert BadInput();
        Submission storage s = subs[index];
        if (s.challenge != Challenge.Open) revert BadState();
        s.challenge = upheld ? Challenge.Upheld : Challenge.Dismissed;
        b.openChallenges -= 1;
        if (upheld) {
            s.passed = true;
            if (!s.stakeSettled) _moveStake(id, index, b, s, s.hunter);
        }
        _settleBond(id, b, s.hunter, upheld);
        emit ChallengeResolved(id, index, upheld);
        _settleVerified(id, b);
        if (b.status != Status.Open) _releaseStakes(id, b);
    }

    /// @notice Safety valve if the arbiter never rules on a poster-judged dispute: the original
    ///         outcome stands (the poster's award, or an even split of the entries the poster did not
    ///         reject) and the disputer gets the bond back.
    function settleStaleDispute(uint256 id) external nonReentrant {
        Bounty storage b = _bounty(id);
        if (b.status != Status.Disputed) revert BadState();
        if (block.timestamp < b.disputedAt + ARBITER_TIMEOUT) revert TooEarly();
        uint128 bond = b.bondSize;
        _settleBond(id, b, b.disputer, true);
        if (b.awardedAt != 0) {
            _payRanks(id, b);
        } else if (!_ghostSplit(id, b)) {
            _refund(id, b);
        }
        _releaseStakes(id, b);
        emit DisputeTimedOut(id, b.disputer, bond);
        emit DisputeResolved(id, new uint32[](0), false);
    }

    /// @notice Safety valve if the arbiter never rules on a verified challenge: the failed check
    ///         stands, the bond goes back, and any later passing entry can be paid.
    function expireChallenge(uint256 id, uint256 index) external nonReentrant {
        Bounty storage b = _bounty(id);
        Submission[] storage subs = _submissions[id];
        if (index >= subs.length) revert BadInput();
        Submission storage s = subs[index];
        if (s.challenge != Challenge.Open) revert BadState();
        if (block.timestamp < s.challengedAt + ARBITER_TIMEOUT) revert TooEarly();
        s.challenge = Challenge.Expired;
        b.openChallenges -= 1;
        uint128 bond = b.bondSize;
        _settleBond(id, b, s.hunter, true);
        emit DisputeTimedOut(id, s.hunter, bond);
        emit ChallengeResolved(id, index, false);
        _settleVerified(id, b);
        if (b.status != Status.Open) _releaseStakes(id, b);
    }

    // ------------------------------------------------------------------ tips

    /// @notice Send extra USDC to a hunter on a bounty. The bounty's locked fee applies.
    function tip(uint256 id, uint256 index, uint128 amount) external nonReentrant {
        Bounty storage b = _bounty(id);
        Submission[] storage subs = _submissions[id];
        if (index >= subs.length || amount == 0) revert BadInput();
        address hunter = subs[index].hunter;
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        uint128 fee = uint128((uint256(amount) * b.feeBps) / 10_000);
        uint128 net = amount - fee;
        feesAccrued += fee;
        claimable[hunter] += net;
        _stats[hunter].tipsReceived += net;
        emit Tipped(id, msg.sender, hunter, net, fee);
    }

    // ------------------------------------------------------------------ withdrawals

    function withdraw() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert BadState();
        claimable[msg.sender] = 0;
        usdc.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    /// @notice Sends accrued protocol fees to the treasury. Anyone can trigger it.
    function withdrawFees() external nonReentrant {
        uint256 amount = feesAccrued;
        if (amount == 0) revert BadState();
        feesAccrued = 0;
        usdc.safeTransfer(treasury, amount);
        emit FeesWithdrawn(treasury, amount);
    }

    // ------------------------------------------------------------------ admin (future bounties only)

    function setFeeBps(uint16 bps) external onlyOwner {
        if (bps > MAX_FEE_BPS) revert BadInput();
        feeBps = bps;
        emit ConfigChanged("feeBps", bps);
    }

    function setTreasury(address t) external onlyOwner {
        if (t == address(0)) revert BadInput();
        treasury = t;
        emit AddressChanged("treasury", t);
    }

    function setArbiter(address a) external onlyOwner {
        if (a == address(0)) revert BadInput();
        arbiter = a;
        emit AddressChanged("arbiter", a);
    }

    function setVerifier(address v) external onlyOwner {
        if (v == address(0)) revert BadInput();
        verifier = v;
        emit AddressChanged("verifier", v);
    }

    /// @notice Capped, and posters pass the most they accept, so a change cannot drain an approval.
    function setFeaturedPrice(uint128 pricePerDay) external onlyOwner {
        if (pricePerDay > MAX_FEATURED_PRICE) revert BadInput();
        featuredPricePerDay = pricePerDay;
        emit ConfigChanged("featuredPricePerDay", pricePerDay);
    }

    /// @notice Applies to bounties posted after the change. Each bounty keeps the bond it was posted with.
    function setDisputeBond(uint128 bond) external onlyOwner {
        if (bond > MAX_DISPUTE_BOND) revert BadInput();
        disputeBond = bond;
        emit ConfigChanged("disputeBond", bond);
    }

    function setWindows(uint32 review, uint32 disputeW, uint32 grace) external onlyOwner {
        if (review < 1 days || review > 30 days || disputeW < 1 hours || disputeW > 14 days) revert BadInput();
        if (grace < 10 minutes || grace > 1 days) revert BadInput();
        reviewWindow = review;
        disputeWindow = disputeW;
        verifyGrace = grace;
        emit ConfigChanged("reviewWindow", review);
        emit ConfigChanged("disputeWindow", disputeW);
        emit ConfigChanged("verifyGrace", grace);
    }

    // ------------------------------------------------------------------ views

    function bountyCount() external view returns (uint256) {
        return _bounties.length;
    }

    function getBounty(uint256 id) external view returns (Bounty memory) {
        return _bounty(id);
    }

    function getSubmissions(uint256 id) external view returns (Submission[] memory) {
        _bounty(id);
        return _submissions[id];
    }

    function getStats(address account) external view returns (Stats memory) {
        return _stats[account];
    }

    function getHunters() external view returns (address[] memory) {
        return _hunters;
    }

    // ------------------------------------------------------------------ internals

    function _bounty(uint256 id) internal view returns (Bounty storage) {
        if (id >= _bounties.length) revert BadInput();
        return _bounties[id];
    }

    function _entryOf(uint256 id, address hunter) internal view returns (uint256, Submission storage) {
        Submission[] storage subs = _submissions[id];
        for (uint256 i; i < subs.length; ++i) {
            if (subs[i].hunter == hunter) return (i, subs[i]);
        }
        revert NotSubmitter();
    }

    function _hasUnchecked(uint256 id) internal view returns (bool) {
        Submission[] storage subs = _submissions[id];
        for (uint256 i; i < subs.length; ++i) {
            if (!subs[i].checked) return true;
        }
        return false;
    }

    function _checkWinners(Mode mode, Submission[] storage subs, uint32[] calldata indexes, bool skipRejected)
        internal
        view
    {
        uint256 n = indexes.length;
        uint256 maxWinners = mode == Mode.Top3Split ? 3 : 1;
        if (n == 0 || n > maxWinners) revert BadInput();
        for (uint256 i; i < n; ++i) {
            uint256 idx = indexes[i];
            if (idx >= subs.length || !subs[idx].revealed) revert BadInput();
            if (skipRejected && subs[idx].rejected) revert BadInput();
            for (uint256 j; j < i; ++j) {
                if (indexes[j] == idx) revert BadInput();
            }
        }
    }

    function _takeBond(Bounty storage b) internal returns (uint128 bond) {
        bond = b.bondSize;
        if (bond > 0) usdc.safeTransferFrom(msg.sender, address(this), bond);
        b.bond += bond;
    }

    /// @dev Releases one bond: back to `to` when upheld (or timed out), otherwise to the protocol.
    function _settleBond(uint256 id, Bounty storage b, address to, bool toDisputer) internal {
        uint128 bond = b.bondSize;
        if (bond == 0) return;
        b.bond -= bond;
        if (toDisputer) claimable[to] += bond;
        else feesAccrued += bond;
        emit BondSettled(id, toDisputer ? to : treasury, bond, !toDisputer);
    }

    function _takeFee(Bounty storage b) internal returns (uint128 net) {
        uint128 fee = uint128((uint256(b.reward) * b.feeBps) / 10_000);
        feesAccrued += fee;
        net = b.reward - fee;
    }

    /// @dev Verified: pays the earliest passing entry once no earlier entrant has an open challenge.
    function _settleVerified(uint256 id, Bounty storage b) internal {
        if (b.status != Status.Open) return;
        Submission[] storage subs = _submissions[id];
        for (uint256 i; i < subs.length; ++i) {
            Submission storage s = subs[i];
            if (s.challenge == Challenge.Open) return;
            if (s.passed) {
                s.rank = 1;
                _payRanks(id, b);
                _releaseStakes(id, b);
                return;
            }
        }
    }

    /// @dev Pays ranked submissions. Weights 50/30/20 for top 3, renormalised when fewer win.
    function _payRanks(uint256 id, Bounty storage b) internal {
        Submission[] storage subs = _submissions[id];
        uint256[3] memory weights = b.mode == Mode.Top3Split ? [uint256(50), 30, 20] : [uint256(100), 0, 0];
        uint256 winners;
        uint256 totalWeight;
        for (uint256 i; i < subs.length; ++i) {
            uint8 r = subs[i].rank;
            if (r != 0) {
                winners++;
                totalWeight += weights[r - 1];
            }
        }
        b.status = Status.Paid;
        b.settledAt = uint64(block.timestamp);
        uint128 net = _takeFee(b);
        uint128 paid;
        uint256 seen;
        for (uint256 i; i < subs.length; ++i) {
            Submission storage s = subs[i];
            if (s.rank == 0) continue;
            seen++;
            uint128 amount = seen == winners ? net - paid : uint128((uint256(net) * weights[s.rank - 1]) / totalWeight);
            paid += amount;
            _credit(s, amount, b.category, true);
            emit WinnerPaid(id, s.hunter, s.rank, amount);
        }
    }

    /// @dev Even split across revealed entries the poster did not reject. Returns false when nobody is eligible.
    function _ghostSplit(uint256 id, Bounty storage b) internal returns (bool) {
        Submission[] storage subs = _submissions[id];
        uint256 eligible;
        for (uint256 i; i < subs.length; ++i) {
            if (subs[i].revealed && !subs[i].rejected) eligible++;
        }
        if (eligible == 0) return false;
        b.status = Status.GhostPaid;
        b.settledAt = uint64(block.timestamp);
        uint128 net = _takeFee(b);
        uint128 share = uint128(net / eligible);
        uint128 dust = net - share * uint128(eligible);
        bool first = true;
        for (uint256 i; i < subs.length; ++i) {
            Submission storage s = subs[i];
            if (!s.revealed || s.rejected) continue;
            uint128 amount = share;
            if (first) {
                amount += dust;
                first = false;
            }
            _credit(s, amount, b.category, false);
            emit GhostShare(id, i, s.hunter, amount);
        }
        emit GhostPaid(id, eligible, net);
        return true;
    }

    function _credit(Submission storage s, uint128 amount, Category category, bool isWin) internal {
        s.payout = amount;
        claimable[s.hunter] += amount;
        Stats storage st = _stats[s.hunter];
        st.earned += amount;
        if (isWin) {
            st.wins += 1;
            st.categoryWins[uint8(category)] += 1;
        }
    }

    /// @dev True when the entry lost its stake: a failed check that stood, a rejection that stood,
    ///      or an entry that never revealed.
    function _forfeits(Submission storage s, Mode mode) internal view returns (bool) {
        if (!s.revealed) return true;
        if (mode == Mode.Verified) return s.checked && !s.passed;
        return s.rejected;
    }

    /// @dev Settles one stake if its fate is final. Returns false if it has to wait.
    function _trySettleStake(uint256 id, uint256 index, Bounty storage b, Submission storage s) internal returns (bool) {
        if (s.stakeSettled) return true;
        bool terminal = b.status == Status.Paid || b.status == Status.GhostPaid || b.status == Status.Refunded;
        if (s.challenge == Challenge.Open) return false;
        if (!s.revealed) {
            // never revealed: forfeits once the reveal window is over
            if (block.timestamp < s.submittedAt + REVEAL_WINDOW) return false;
            _moveStake(id, index, b, s, _forfeitTo(b));
            return true;
        }
        if (_forfeits(s, b.mode)) {
            // M-3: held until this entry's dispute window has closed
            if (block.timestamp < s.judgedAt + b.disputeWindow) return false;
            if (b.status == Status.Disputed) return false;
            _moveStake(id, index, b, s, _forfeitTo(b));
            return true;
        }
        if (!terminal) return false;
        _moveStake(id, index, b, s, s.hunter);
        return true;
    }

    /// @dev Verified forfeits compensate the poster for checking spam (the poster does not judge).
    ///      Poster-judged forfeits go to the protocol so a poster never profits from a rejection.
    function _forfeitTo(Bounty storage b) internal view returns (address) {
        return b.mode == Mode.Verified ? b.poster : address(this);
    }

    function _moveStake(uint256 id, uint256 index, Bounty storage b, Submission storage s, address to) internal {
        s.stakeSettled = true;
        uint128 amount = b.entryStake;
        b.stakeHeld -= amount;
        if (to == address(this)) feesAccrued += amount;
        else claimable[to] += amount;
        emit StakeSettled(id, index, to == address(this) ? treasury : to, amount, to != s.hunter);
    }

    /// @dev Settles every stake that can be settled now. Forfeits still inside a dispute window wait for settleStake.
    function _releaseStakes(uint256 id, Bounty storage b) internal {
        if (b.stakeHeld == 0) return;
        Submission[] storage subs = _submissions[id];
        for (uint256 i; i < subs.length; ++i) {
            _trySettleStake(id, i, b, subs[i]);
        }
    }

    function _refund(uint256 id, Bounty storage b) internal {
        b.status = Status.Refunded;
        b.settledAt = uint64(block.timestamp);
        claimable[b.poster] += b.reward;
        emit Refunded(id, b.poster, b.reward);
    }
}
