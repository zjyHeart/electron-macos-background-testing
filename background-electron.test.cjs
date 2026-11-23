// This probe keeps its temporary files and never launches an installed application.
const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, mkdirSync, mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { execFileSync } = require('node:child_process');
const { _electron: electron } = require('playwright');

const preload = resolve(__dirname, 'background-electron.cjs');

function frontmostProcess() {
  return execFileSync('osascript', [
    '-e', 'tell application "System Events"',
    '-e', 'set p to first application process whose frontmost is true',
    '-e', 'return {name of p, unix id of p}',
    '-e', 'end tell',
  ], { encoding: 'utf8' }).trim();
}

test('hidden Electron supports Playwright input and preserves the foreground', { skip: process.platform !== 'darwin' }, async t => {
  assert.ok(existsSync(preload), `background preload must exist: ${preload}`);
  const root = mkdtempSync(join(tmpdir(), 'electron-background-probe-'));
  const artifacts = join(root, 'artifacts');
  mkdirSync(artifacts);
  const html = '<html><body style="background:rgb(32,160,224)"><input aria-label="Input"><button>Click</button><script>window.clicks=0;document.querySelector("button").addEventListener("click",()=>window.clicks++)</script></body></html>';
  const main = `const {app,BrowserWindow}=require('electron');\napp.setPath('userData',${JSON.stringify(join(root, 'profile'))});\napp.whenReady().then(()=>{const w=new BrowserWindow({width:600,height:400});w.loadURL(${JSON.stringify(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)});});\n`;
  const mainPath = join(root, 'main.cjs');
  writeFileSync(mainPath, main, 'utf8');
  t.diagnostic(`Retained isolated fixture: ${root}`);
  const before = frontmostProcess();
  // Supplying artifactsDir prevents Playwright from registering its own temporary artifacts directory for cleanup.
  const app = await electron.launch({ args: ['-r', preload, mainPath], artifactsDir: artifacts, timeout: 20_000 });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
    // Prevent hardware input from being delivered to the test window.
    await app.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.setFocusable(false);
        window.setIgnoreMouseEvents(true);
        window.blur();
      }
    });
    assert.equal(frontmostProcess(), before, 'launch must leave the foreground app unchanged');
    await page.getByRole('button', { name: 'Click' }).click();
    assert.equal(await page.evaluate(() => window.clicks), 1);
    const input = page.getByRole('textbox', { name: 'Input' });
    await input.fill('hello');
    assert.equal(await input.inputValue(), 'hello');
    await input.focus();
    await page.keyboard.press('Meta+A');
    await page.keyboard.type('typed');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Backspace');
    assert.equal(await input.inputValue(), 'typd');
    const screenshot = await page.screenshot();
    const pixel = await app.evaluate(({ nativeImage }, encoded) => {
      const image = nativeImage.createFromBuffer(Buffer.from(encoded, 'base64'));
      const size = image.getSize();
      const offset = (Math.floor(size.height * 0.8) * size.width + Math.floor(size.width * 0.8)) * 4;
      return [...image.toBitmap().subarray(offset, offset + 4)];
    }, screenshot.toString('base64'));
    // macOS color management can adjust exact values; native bitmap is BGRA here.
    assert.ok(pixel[0] > pixel[1] + 30 && pixel[1] > pixel[2] + 30, `expected blue background, got ${pixel}`);
    assert.equal(frontmostProcess(), before, 'interaction must leave the foreground app unchanged');
  } finally {
    await app.close();
  }
});
