import "@testing-library/jest-dom/vitest";

// jsdom's Blob/File implementation exposes only slice/size/type (see
// https://github.com/jsdom/jsdom/issues/2555) — `.text()` is real-browser
// behaviour our code relies on (intake reads dropped files), so route it
// through jsdom's own FileReader, which does support Blob content.
if (typeof Blob !== "undefined" && typeof Blob.prototype.text !== "function") {
  Blob.prototype.text = function (this: Blob) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this);
    });
  };
}
