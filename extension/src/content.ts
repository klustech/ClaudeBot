import { executeInPage } from "./broker/executor";
import type { SignedCommand } from "./security/permissions";

// Content scripts only act on commands relayed by our background worker,
// which has already verified the signature, allow-list and expiry.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const m = message as { kind?: string; command?: SignedCommand };
  if (m.kind !== "ct-execute" || !m.command) return;
  void executeInPage(m.command).then(sendResponse);
  return true;
});
