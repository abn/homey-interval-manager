# homey-interval-manager

A lightweight TypeScript library for managing intervals in Homey devices. Simplifies the process of scheduling and 
managing recurring tasks within your Homey devices.

## Features

-   **Easy interval management:** Start, stop, and restart intervals with a simple API.
-   **Flexible configuration:** Define intervals with custom functions, settings, and intervals.
-   **Automatic restarts:** Optionally restart intervals when device settings change.
-   **TypeScript support:** Provides type definitions for improved code clarity and maintainability.

## Installation

```bash
npm install homey-interval-manager
```

## Usage

1. **Import the class:**

<!-- end list -->

```typescript
import HomeyIntervalManager from "homey-interval-manager";
```

2. **Create an instance:**

<!-- end list -->

```typescript
// In your device class constructor:
this.intervalManager = new HomeyIntervalManager(this, {
    SOME_KEY: {
        functionName: "myFunction", // Name of the function to execute
        settingName: "mySetting", // Optional setting to watch for changes
        intervalSeconds: 300, // Optional interval in seconds (default: 600)
        disableAutoStart: false, // Optional, prevent auto-start on device init
    },
    // ... more interval configurations ...
});
```

3. **Start the intervals:**

<!-- end list -->

```typescript
// Start all intervals (defined in the config)
await this.intervalManager.start();

// Or start specific intervals
await this.intervalManager.start("SOME_KEY", "SOME_OTHER_KEY");
```

4. **Stop the intervals:**

<!-- end list -->

```typescript
// Stop all intervals
await this.intervalManager.stop();

// Or stop a specific interval
await this.intervalManager.clearInterval("myInterval");
```

5. **Restart intervals:**

<!-- end list -->

```typescript
// Restart all intervals
await this.intervalManager.restart();

// Restart intervals associated with specific settings
await this.intervalManager.restart("mySetting", "anotherSetting");
```

## Example

```typescript
import OAuth2Device from "homey-oauth2app";
import HomeyIntervalManager from "homey-interval-manager";

class SomeCloudApiDevice extends OAuth2Device {
    private intervalManager: HomeyIntervalManager;

    async onOAuth2Init() {
        this.intervalManager = new HomeyIntervalManager(
            this,
            {
                STATUS_UPDATE: {
                    functionName: "syncStatusUpdate",
                    settingName: "status_update_polling_interval",
                },
            },
            600,
            true,
        );
        await this.intervalManager.start();
    }

    async syncStatusUpdate() {
        // fetch api data and set capability
    }

    async onOAuth2Uninit() {
        await this.intervalManager.stop();
    }

    async onSettings({ oldSettings, newSettings, changedKeys }) {
        // perform your other tasks
        this.homey.setTimeout(async () => {
            await this.intervalManager.restart(...changedKeys);
        }, 1000);
    }
}

```

## Contributing

Contributions are welcome\! Feel free to open issues or submit pull requests.

## License

[MIT](LICENSE)
