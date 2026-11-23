# Background Electron tests on macOS

An Electron test may repeatedly bring its window or app to the foreground when an automation suite launches or restarts the app. This can interrupt the user, particularly with macOS Stage Manager enabled. Making a window unfocusable *after* it appears may happen too late to prevent the initial switch.

This repository contains a **test-only workaround**, not a confirmed Electron defect or a general headless mode. The preload requests macOS accessory activation policy before the first window is created, creates CommonJS `BrowserWindow` instances hidden, and disables background throttling for ordinary windows so they can render. The app's normal launch is not modified.

## Use with Playwright

Put `background-electron.cjs` in the test project, then add the preload argument **before the app path**:

```js
const { _electron: electron } = require('playwright');
const path = require('node:path');

async function launchForTest() {
  return electron.launch({
    args: ['-r', path.resolve('background-electron.cjs'), '.'],
  });
}
```

The same preload can be passed to a development Electron executable using `electron -r /absolute/path/background-electron.cjs /path/to/app`. Use an isolated test profile and test data. A separate visible test run remains necessary for native-window behavior. The snippet does not force an app to use an isolated profile: use the app's supported profile or data-directory option.

## Check the workaround

On macOS with a graphical session and Node.js installed:

```sh
npm install
npm test
```

The probe launches a small isolated fixture. It checks that the window is hidden, the foreground app's name and PID are unchanged at the sampled checkpoints, Playwright can click and type including keyboard shortcuts, and a screenshot contains the rendered background. macOS may ask for permission to control System Events when it reads the foreground application. The test retains its isolated temporary directory and prints its path.

Tested with Node.js 24.16.0, Electron 41.10.7 and Playwright 1.63.0 on macOS 26.6.2 with Stage Manager enabled. A corresponding independent probe passed three repeated runs. Foreground checks are sampled, so they do not exclude a transient switch between samples; no assertion is made about every macOS or Electron version.

Related reports: [electron/electron#30904](https://github.com/electron/electron/issues/30904) discusses focus behavior on macOS, and [electron/electron#49393](https://github.com/electron/electron/issues/49393) reports `showInactive` bringing a window forward. These are related symptoms; they do not establish the cause of this scenario.

## Scope and limitations

- The preload is active on macOS only and applies to calls to `require('electron').BrowserWindow` made after the preload. It does not intercept ESM imports or `electron/main`.
- It uses Node's internal `Module._load` hook, so compatibility can change with Node or Electron versions. Test it with the actual application and dependencies.
- It sets the initial `show` option to `false`, but an app or test can still explicitly call `show`, `showInactive`, `restore` or focus methods later and bring a window forward. Accessory mode alone does not guarantee that the app cannot activate.
- It changes timing and background-throttling behavior, which can affect tests of visibility or lifecycle behavior. Run a visible suite for minimizing, restoring, native dialogs and focus behavior.
- Packaged applications may disable the Node options required by `-r` through Electron fuses; this approach targets development Electron launches and has not been verified for packaged apps.
- The probe tests a small synthetic page, not an arbitrary application's embedded browser, native dialogs, video rendering, notifications, or every Playwright operation. Validate those paths separately.
- Avoid exposing the debugging interface beyond the local trusted environment, and do not run this test against a real user profile.
