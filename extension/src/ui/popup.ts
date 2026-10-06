const input = document.getElementById("secret") as HTMLInputElement;
const statusEl = document.getElementById("statusEl") as HTMLElement;
document.getElementById("save")?.addEventListener("click", async () => {
  if (input.value.length < 32) {
    statusEl.textContent = "Secret must be at least 32 characters.";
    return;
  }
  await chrome.storage.local.set({ bridgeSecret: input.value });
  input.value = "";
  statusEl.textContent = "Saved.";
});
void chrome.storage.local.get(["bridgeSecret"]).then((s) => {
  statusEl.textContent = s.bridgeSecret ? "Paired." : "Not paired.";
});
export {};
