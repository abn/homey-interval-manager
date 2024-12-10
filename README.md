# homey-interval-manager

A lightweight TypeScript library for managing intervals in Homey Apps, Devices and Drivers. Simplifies the process of
scheduling and managing recurring tasks within your Homey applications.

## Features

- **Easy interval management:** Start, stop, and restart intervals with a simple API.
- **Flexible configuration:** Define intervals with custom functions, settings, and intervals.
- **Automatic restarts:** Optionally restart intervals when device settings change.
- **TypeScript support:** Provides type definitions for improved code clarity and maintainability.

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
this.intervalManager = new HomeyIntervalManager(
    this,
    {
        SOME_KEY: {
            functionName: "myFunction", // Name of the function to execute
            settingName: "mySetting", // Optional setting to watch for changes
            intervalSeconds: 300, // Optional interval in seconds (default: 600)
            disableAutoStart: false, // Optional, prevent auto-start on device init
        },
        SOME_OTHER_KEY: {
            functionName: "myOtherFunction", // Name of the function to execute
        },
        // ... more interval configurations ...
    },
    600,
); // defaults to 10 minutes if no interval or setting name provided
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
await this.intervalManager.restart("mySetting");
```

## Example

```typescript
import { OAuth2Device } from "homey-oauth2app";
import { HomeyIntervalManager, IntervalConfiguration, IntervalConfigurationCollection } from "homey-interval-manager";

type DeviceSettingsValue = boolean | string | number | undefined | null;
type DeviceSettings = Record<string, DeviceSettingsValue>;

class SomeCloudApiDevice extends OAuth2Device {
    protected intervalManager!: HomeyIntervalManager<this>;

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

    async syncStatusUpdate(): Promise<void> {
        const status = await this.get({ path: "/status" });
        await this.setCapabilityValue("device_status", status.name);
    }

    async onOAuth2Uninit() {
        await this.intervalManager.stop();
    }

    async onSettings(event: {
        oldSettings: DeviceSettings;
        newSettings: DeviceSettings;
        changedKeys: string[];
    }): Promise<string | void> {
        this.log("SomeCloudApi device settings where changed");
        const changedKeys = event.changedKeys as IntervalConfiguration<this>["settingName"][] & string[];
        this.homey.setTimeout(async () => {
            await this.intervalManager.restartBySettings(...changedKeys);
        }, 1000);
    }
}
```

## Contributing

Contributions are welcome\! Feel free to open issues or submit pull requests.

## License

[MIT](LICENSE)
