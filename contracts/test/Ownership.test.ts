// Two-step ownership, picked from Arc Studio's BountyArena (PICKED_FROM_STUDIO.md, pick 3).
// A typo in transferOwnership must never hand the admin keys to an address nobody controls.
import { expect } from "chai";
import { ethers } from "hardhat";

describe("Ownership", () => {
  async function deploy() {
    const [owner, treasury, arbiter, verifier, next, stranger] = await ethers.getSigners();
    const usdc = await ethers.deployContract("MockUSDC");
    const arena = await ethers.deployContract("BountyArena", [await usdc.getAddress(), treasury.address, arbiter.address, verifier.address]);
    return { arena, owner, next, stranger };
  }

  it("keeps the old owner until the new one accepts", async () => {
    const { arena, owner, next } = await deploy();
    await arena.connect(owner).transferOwnership(next.address);
    expect(await arena.owner()).to.equal(owner.address);
    expect(await arena.pendingOwner()).to.equal(next.address);
    await arena.connect(next).acceptOwnership();
    expect(await arena.owner()).to.equal(next.address);
    expect(await arena.pendingOwner()).to.equal(ethers.ZeroAddress);
  });

  it("lets nobody but the pending owner accept", async () => {
    const { arena, owner, next, stranger } = await deploy();
    await arena.connect(owner).transferOwnership(next.address);
    await expect(arena.connect(stranger).acceptOwnership()).to.be.revertedWithCustomError(arena, "OwnableUnauthorizedAccount");
    expect(await arena.owner()).to.equal(owner.address);
  });

  it("lets the owner correct a wrong transfer before it is accepted", async () => {
    const { arena, owner, next, stranger } = await deploy();
    await arena.connect(owner).transferOwnership(stranger.address);
    await arena.connect(owner).transferOwnership(next.address);
    await expect(arena.connect(stranger).acceptOwnership()).to.be.revertedWithCustomError(arena, "OwnableUnauthorizedAccount");
    await arena.connect(next).acceptOwnership();
    expect(await arena.owner()).to.equal(next.address);
  });
});
