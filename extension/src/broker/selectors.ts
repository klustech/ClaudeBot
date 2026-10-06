/**
 * Broker-specific DOM selectors. These MUST be filled in for the specific
 * fixed-payout venue (inspect its UI). Placeholders deliberately match
 * nothing so an unconfigured extension cannot click anything.
 */
export const SELECTORS = {
  accountId: "[data-ct='account-id']",
  balance: "[data-ct='balance']",
  marketName: "[data-ct='market']",
  price: "[data-ct='price']",
  payout: "[data-ct='payout']",
  stakeInput: "[data-ct='stake-input']",
  expirySelect: "[data-ct='expiry']",
  upButton: "[data-ct='button-up']",
  downButton: "[data-ct='button-down']",
  confirmation: "[data-ct='trade-confirmation']",
  confirmationTradeId: "[data-ct='confirmation-id']",
  confirmationStake: "[data-ct='confirmation-stake']",
  confirmationPayout: "[data-ct='confirmation-payout']",
  openContracts: "[data-ct='open-contract']",
} as const;
