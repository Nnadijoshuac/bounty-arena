import { encodeAbiParameters, keccak256, toHex, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import { arenaAbi, erc20Abi } from "./abi";
import { hashText, publishText } from "./store";

/**
 * Entering a bounty is two steps (the fix for copied deliverables, audit H-1):
 *   1. submit(id, commitment) where commitment = keccak256(abi.encode(id, hunter, contentHash, salt))
 *   2. after that transaction is mined: publish the text, then reveal(id, index, contentHash, salt)
 *      within 10 minutes.
 * Nobody can copy the text into an earlier slot, because it is only public after your slot exists,
 * and the same content can only be revealed once per bounty.
 */
export function newSalt(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

export function commitmentFor(id: bigint | number, hunter: Address, contentHash: Hex, salt: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" }],
      [BigInt(id), hunter, contentHash, salt],
    ),
  );
}

export type EnterResult = { index: number; contentHash: Hex; salt: Hex; commitment: Hex; submitTx: Hex; revealTx: Hex };

/**
 * Full entry flow from a connected wallet: approve the stake if needed, submit the commitment,
 * wait for it, publish the text to ArenaTextStore, then reveal.
 * Pass `publish` to use another store (for example httpStore().put on the local demo).
 */
export async function enterBounty(opts: {
  client: PublicClient;
  wallet: WalletClient;
  arena: Address;
  textStore: Address;
  id: bigint | number;
  text: string;
  publish?: (text: string) => Promise<Hex>;
}): Promise<EnterResult> {
  const { client, wallet, arena, textStore, text } = opts;
  const id = BigInt(opts.id);
  const account = wallet.account ?? ((await wallet.getAddresses())[0] as Address);
  const hunter = (typeof account === "string" ? account : account.address) as Address;
  const write = async (address: Address, abi: any, functionName: string, args: unknown[]) => {
    const { request, result } = await client.simulateContract({ address, abi, functionName, args, account } as any);
    const hash = await wallet.writeContract(request as any);
    await client.waitForTransactionReceipt({ hash });
    return { hash, result };
  };

  const b = (await client.readContract({ address: arena, abi: arenaAbi, functionName: "getBounty", args: [id] })) as any;
  if (b.entryStake > 0n) {
    const usdc = (await client.readContract({ address: arena, abi: arenaAbi, functionName: "usdc" })) as Address;
    const allowance = (await client.readContract({ address: usdc, abi: erc20Abi, functionName: "allowance", args: [hunter, arena] })) as bigint;
    if (allowance < b.entryStake) await write(usdc, erc20Abi, "approve", [arena, b.entryStake]);
  }

  const contentHash = hashText(text);
  const salt = newSalt();
  const commitment = commitmentFor(id, hunter, contentHash, salt);
  const submitted = await write(arena, arenaAbi, "submit", [id, commitment]);
  const index = Number(submitted.result);

  // only now is the text made public
  if (opts.publish) await opts.publish(text);
  else await publishText(client, wallet, textStore, "deliverable", text);

  const revealed = await write(arena, arenaAbi, "reveal", [id, BigInt(index), contentHash, salt]);
  return { index, contentHash, salt, commitment, submitTx: submitted.hash, revealTx: revealed.hash };
}
