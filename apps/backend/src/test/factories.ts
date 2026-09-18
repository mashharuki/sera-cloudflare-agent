export type TestUser = {
  id: string;
  privyDid: string;
};

export const createTestUser = (
  overrides: Partial<TestUser> = {},
): TestUser => ({
  id: "01990000-7000-8000-8000-000000000001",
  privyDid: "did:privy:test-user",
  ...overrides,
});

export type TestWallet = {
  address: `0x${string}`;
  chainId: 11155111;
  walletId: string;
};

export const createTestWallet = (
  overrides: Partial<TestWallet> = {},
): TestWallet => ({
  address: "0x0000000000000000000000000000000000000001",
  chainId: 11155111,
  walletId: "wallet-test-1",
  ...overrides,
});
