const status = document.querySelector("#status");

document.querySelector("#download-log").addEventListener("click", async () => {
  status.hidden = true;
  try {
    const response = await browser.runtime.sendMessage({ scope: "bmgrid", action: "log" });
    if (!response?.ok) throw new Error(response?.error ?? "Unable to access the deletion log.");
    const url = URL.createObjectURL(new Blob([response.result], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "deletion-log.txt";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => { URL.revokeObjectURL(url); }, 60000);
  } catch (error) {
    status.textContent = error.message ?? String(error);
    status.hidden = false;
  }
});
