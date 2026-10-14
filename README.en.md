<div align="center">

<p><a href="README.md">简体中文</a> | <strong>English</strong></p>

<p><a href="https://github.com/linghungegeg/liandong-card-client/releases/latest/download/LiandongCard-v0.1.0-windows-x64-portable.zip"><strong>Download for Windows (portable)</strong></a> | <a href="https://github.com/linghungegeg/liandong-card-client/releases">Releases</a></p>

# Liandong Card Client

A desktop tool for Liandong Shop merchants to manage accounts, publish digital code products, and automate stock replenishment.

<p>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="MIT License" /></a>
  <img src="https://img.shields.io/badge/version-0.1.0-2563eb?style=flat-square" alt="Version 0.1.0" />
  <img src="https://img.shields.io/badge/platform-Windows_x64-0078D4?style=flat-square" alt="Windows x64" />
  <img src="https://img.shields.io/badge/Electron-44-47848F?style=flat-square&amp;logo=electron&amp;logoColor=white" alt="Electron 44" />
  <img src="https://img.shields.io/badge/React-19-149ECA?style=flat-square&amp;logo=react&amp;logoColor=white" alt="React 19" />
  <img src="https://img.shields.io/badge/Vite-8-646CFF?style=flat-square&amp;logo=vite&amp;logoColor=white" alt="Vite 8" />
  <img src="https://img.shields.io/badge/SQLite-local-003B57?style=flat-square&amp;logo=sqlite&amp;logoColor=white" alt="Local SQLite" />
</p>

Isolated account sessions · Product publishing · TXT / CSV / XLSX import · Stock monitoring · Automatic replenishment

</div>

---

<div align="center">
  <p><strong>Advertisement</strong></p>
  <p><strong>GPT without quality degradation. Full-capability Claude API access:</strong> <a href="https://www.1openai.icu/">https://www.1openai.icu/</a><br />
  High quality, no compromises, and great value. Try it and put it to the test.</p>
  <p>Enter your activation code in the service dashboard to get started.</p>
</div>

---

## About

Liandong Card Client is an Electron desktop application that brings Liandong Shop's digital code product management into one place. Switch between merchant accounts, synchronize products and stock, publish products, import local codes, and replenish stock automatically using configurable rules.

Each account has its own persistent browser session. Business requests run in that account's official website environment, reusing its login session and the site's request module. Everyday operations take place in the client; open the account's website window when login verification is needed.

The project focuses on **digital code products**. It currently excludes orders, marketing, distribution, financial management, and cloud synchronization. No separate business backend or Python service is required. This is a third-party tool and is not affiliated with Liandong Shop.

## Features

| Module | Features |
| --- | --- |
| Dashboard | View login status, product counts, platform stock, monitoring tasks, low-stock alerts, and recent replenishment results for one or all accounts |
| Account management | Add and switch accounts, sign in with account credentials, check sessions, and open the account's website; sessions are stored separately |
| Digital code products | Synchronize products, view product details and available platform stock, and filter or paginate the list |
| Product publishing | Enter product information, upload images, edit rich-text descriptions and instructions, and verify publication results |
| Manual replenishment | Paste codes or use an imported source, preview before submitting, and record each batch and its accepted codes |
| Code sources | Import TXT, CSV, and XLSX files; select worksheets and columns, combine columns, skip headers, and bind sources to accounts and products |
| Stock monitoring | Configure a low-stock threshold and check interval, replenish by a fixed amount or to a target stock level, and enable or disable each rule |
| Replenishment history | View manual and automatic batches, filter by account and status, paginate records, and recheck pending results |

Automatic replenishment runs only when platform stock is **strictly below the threshold**. Stock and rule status are checked again before submission. Requests are queued per account, and overlapping replenishment tasks for the same product are prevented. Invalid sessions, insufficient local codes, or uncertain results pause the affected monitoring task.

## Screenshots

The screenshots below show the Chinese interface.

### Dashboard

View account status, platform stock, low-stock alerts, and recent replenishment activity.

<table>
  <tr><td><img src="img/Snipaste_2026-10-15_05-56-48.png" alt="Dashboard: account status, platform stock, and low-stock alerts" width="1100" /></td></tr>
</table>

### Account management

Manage login status, synchronization times, and session checks, and open the corresponding website window when needed.

<table>
  <tr><td><img src="img/Snipaste_2026-10-15_05-56-54.png" alt="Account management: login, session checks, synchronization, and website access" width="1100" /></td></tr>
</table>

### Digital code products

Browse product names, prices, status, sales, and stock, with direct access to replenishment and inventory views.

<table>
  <tr><td><img src="img/Snipaste_2026-10-15_05-56-59.png" alt="Digital code products: product list, prices, sales status, and stock" width="1100" /></td></tr>
</table>

### Stock monitoring

Bind a code source to a product and configure the threshold, replenishment method, and check interval.

<table>
  <tr><td><img src="img/Snipaste_2026-10-15_05-57-13.png" alt="Stock monitoring: low-stock threshold, target stock, and automatic replenishment rules" width="1100" /></td></tr>
</table>

## Getting started

### Using the Windows portable package

1. Obtain the Windows x64 portable ZIP and extract it to a local directory.
2. Run `LiandongCard.exe`. Keep `resources`, `locales`, DLLs, and the other files together; do not copy only the EXE.
3. Add an account under **Account management** and sign in. If manual verification is required, use **Open website** to complete it.
4. Synchronize products under **Digital code products**. To create a product, open **Product publishing**.
5. Under **Code sources**, select an account and product, import a file, review the preview, and save it.
6. Under **Manual replenishment**, select a source and quantity to submit. For automatic replenishment, save a rule under **Stock monitoring** and enable it separately.
7. Review results in **Replenishment history**. Recheck any **Pending confirmation** batch before taking further action.

The portable package includes its runtime; Node.js and Python are not required. Account sessions and local data are stored in the current user's application data directory, separate from the EXE directory.

### Importing codes

- **TXT:** One code per line. The import preview counts blank lines, duplicates, and valid entries.
- **CSV / XLSX:** Choose a worksheet, code columns, a separator for combining columns, and whether to skip the header.
- **Leading zeros:** Format code and password cells as text in Excel. Zeros already lost in the original file cannot be recovered.
- **Deduplication:** Identical codes are deduplicated within the same account. Blank lines do not count as valid codes.
- **Source snapshots:** Imports save a snapshot of the file contents without modifying the original file. Select and import the file again after adding new codes.

## Technology stack

These versions match the dependencies pinned in the current `package.json`.

| Layer | Technology | Purpose |
| --- | --- | --- |
| Desktop runtime | Electron 44.7.2 | Windows, isolated account sessions, file dialogs, and main-process capabilities |
| Frontend | React / React DOM 19.3.0 | Rendering and interaction |
| UI components | Arco Design 2.66.18 | Tables, forms, dialogs, pagination, and notifications |
| Rich-text editor | wangEditor 5.1.23 / React adapter 1.0.6 | Product descriptions and usage instructions |
| Local storage | Node.js built-in `node:sqlite` | Accounts, products, sources, rules, and batch records |
| Code encryption | Electron `safeStorage` | Encryption of locally stored code contents |
| Spreadsheet parsing | `@e965/xlsx` 0.20.3 | CSV / XLSX file reading |
| Frontend build | Vite 8.3.4 | Development server and static asset builds |
| Desktop packaging | `@electron/packager` 20.3.0 | Windows x64 application directories and ASAR packaging |
| Automated testing | Node.js built-in `node:test` | Import, replenishment, reconciliation, and regression tests |

## Local development

### Requirements

- Windows x64, the target platform of the current packaging script.
- Node.js **22.13.0 or later**; Node.js 24 is recommended. Tests use the built-in `node:sqlite` module.
- npm, using the repository's `package-lock.json` to install dependencies.
- Network access to the Liandong Shop website and a merchant account for business operations.

Run the following in the project root:

```powershell
npm ci
npm run dev:desktop
```

`dev:desktop` starts the development server at `http://127.0.0.1:5188` and opens the Electron client. Closing the client stops the development server. Frontend changes update through Vite; changes to main-process code under `electron/` require restarting the client.

`npm run dev` starts only the frontend development server. A browser preview does not have Electron account sessions or IPC capabilities; use the desktop window for complete business operations.

### Commands

| Command | Purpose |
| --- | --- |
| `npm ci` | Install dependencies from the lockfile |
| `npm run dev:desktop` | Start the complete desktop development environment |
| `npm run dev` | Start only the frontend development server |
| `npm run check` | Check syntax in Electron main-process and business modules |
| `npm test` | Run local automated tests |
| `npm run build` | Build the frontend into `dist/` |
| `npm start` | Build the frontend and start Electron |
| `npm run package` | Build and package the Windows x64 application directory |

### Separate data directory

Set `LIANDONG_DATA_DIR` when debugging to keep development data separate from everyday use:

```powershell
$env:LIANDONG_DATA_DIR = Join-Path $env:TEMP "liandong-card-dev"
npm run dev:desktop
```

This variable affects both the database and account session directories. To restore the default path, run `Remove-Item Env:LIANDONG_DATA_DIR` in the current PowerShell session and restart the client.

## Building and packaging

Build only the frontend assets:

```powershell
npm run build
```

The output is written to `dist/`. This command does not create a desktop application package.

Check and package the Windows x64 client:

```powershell
npm ci
npm run check
npm test
npm run package
```

The current script uses Electron Packager and ASAR, producing:

```text
release/
└─ 0.1.0/
   └─ LiandongCard-win32-x64/
      ├─ LiandongCard.exe
      ├─ resources/
      ├─ locales/
      └─ ...
```

`npm run package` creates a complete application directory. It **does not automatically create a ZIP or installer**. To distribute a portable version, archive the entire `LiandongCard-win32-x64/` directory. The script currently writes to `release/0.1.0/`; build artifacts are not committed with the source.

The packaging script excludes `.runtime/`, `.research/`, `release/`, `tests/`, `scripts/`, and `src/`. Account sessions and the database are stored in the system application data directory by default. Use clean build artifacts for distribution.

## Project structure

```text
.
├─ electron/
│  ├─ main.cjs             # Entry point, windows, sessions, IPC, and file import
│  ├─ preload.cjs          # Restricted business API exposed to the UI
│  ├─ protocol.cjs         # Official request wrapper, product fields, and validation
│  ├─ stock.cjs            # Code parsing, monitoring, replenishment, and reconciliation
│  └─ store.cjs            # SQLite storage, account isolation, and batch records
├─ src/
│  ├─ main.jsx             # React pages, business forms, and interaction
│  └─ style.css            # Client styles
├─ scripts/
│  ├─ dev.cjs              # Combined Vite and Electron startup
│  ├─ acceptance.cjs       # Live acceptance script; writes to the official platform
│  ├─ review-check.cjs     # Desktop verification script
│  └─ package-smoke.cjs    # Packaged application startup check
├─ tests/
│  ├─ core.test.cjs        # Core business tests
│  ├─ review-fixes.test.cjs # Replenishment, state, and pagination regressions
│  └─ fixtures/            # Sample code files for tests
├─ img/                    # Screenshots, WeChat contact QR, and donation code
├─ index.html              # Frontend HTML entry point
├─ package.json            # Project metadata, dependencies, and scripts
├─ package-lock.json       # Dependency lockfile
├─ .gitignore              # Local data and build artifact exclusions
├─ LICENSE                 # MIT License
├─ README.en.md            # English documentation
└─ README.md               # Chinese documentation (default)
```

`node_modules/`, `dist/`, `release/`, `.runtime/`, and `.research/` contain dependencies, build artifacts, or local debugging material and are excluded from source control.

## Data and runtime behavior

- **Account isolation:** Each account uses its own `persist:liandong-<account ID>` session partition. Business data is associated with the corresponding account.
- **Local storage:** The database is `client.sqlite` in the application data directory. Code contents are encrypted with system-backed `safeStorage`; the client refuses to save codes if encryption is unavailable.
- **Session checks:** While running, the client checks logged-in accounts' sessions and merchant identities approximately every five minutes. Expired sessions or changed identities pause the corresponding monitoring rules; sign in again and confirm before resuming.
- **Reconciliation:** Replenishment is verified using official responses and code record readback. Uncertain results after a timeout, network failure, or interrupted process remain pending confirmation and are not automatically resubmitted before verification.
- **Exit behavior:** Closing the main window exits the client and stops monitoring. Automatic replenishment requires the application to remain running.
- **Window security:** Official pages have no Node.js access, `webSecurity` remains enabled, and the UI accesses business capabilities through restricted IPC.

## FAQ

**Why do platform stock and local code counts differ?**

Platform stock is the number of codes available for sale on the official platform. Local stock contains imported codes that have not yet been uploaded. They are tracked separately. If the platform does not return stock, it is shown as unknown rather than zero.

**Why is a replenishment batch pending confirmation?**

The platform may have received the request while its response or record readback is incomplete. Recheck the batch in **Replenishment history** before uploading the same codes again.

**Are changes to imported files picked up automatically?**

No. Sources store a snapshot taken at import time. Select and import the file again to add new codes.

**Can I copy the portable application and its data to another computer?**

You can copy the application files. Data is stored separately in the system application data directory, and code encryption depends on the system environment. Copying the database between computers is not a supported data migration method.

**Are macOS, Linux, or background operation supported?**

The current packaging script targets only Windows x64; distribution instructions for other systems are not provided. Closing the main window stops monitoring and exits the application.

## Feedback and contributions

Bug reports and improvement suggestions are welcome. Include the application version, operating environment, reproduction steps, and relevant screenshots. Redact account credentials and real codes.

Before submitting code, run `npm run check`, `npm test`, and `npm run build`. `scripts/acceptance.cjs` publishes real products and uploads codes; run it only with explicitly authorized test accounts and test content. Passing local tests does not establish live business acceptance.

### License

This project is licensed under the [MIT License](LICENSE). See `LICENSE` for the full terms.

## Contact and support

Scan the WeChat QR code below for usage questions, feedback, or collaboration. If the project has helped you, voluntary donations are welcome to support ongoing maintenance.

<table align="center">
  <tr>
    <th align="center">WeChat contact</th>
    <th align="center">Support the project</th>
  </tr>
  <tr>
    <td align="center"><img src="img/wx.jpg" alt="WeChat contact QR code" width="280" /></td>
    <td align="center"><img src="img/zhanshang.png" alt="WeChat donation code" width="280" /></td>
  </tr>
  <tr>
    <td align="center">Scan to connect and discuss the client</td>
    <td align="center">Voluntary donations. Thank you for your support.</td>
  </tr>
</table>
