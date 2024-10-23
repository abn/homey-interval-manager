import type { Device } from "homey";

/**
 * Represents the configuration for an interval-based operation on a device.
 *
 * @template T - Extends from the [Homey Device](https://apps-sdk-v3.developer.homey.app/Device.html) type defining
 *  {@link IntervalConfiguration.functionName} if specified.
 * @property {keyof T & string} functionName - The name of the function to be executed on the device, must be defined by
 *  the device instance.
 * @property {string} [settingName] - An optional setting name associated with the interval operation. If specified and
 *  contains a valid number value, this is used as the delay between intervals. This takes precedence over
 *  {@link IntervalConfiguration.intervalSeconds}.
 * @property {number} [intervalSeconds] - An optional interval time in seconds for configuring delay between executions
 *  of {@link IntervalConfiguration.functionName|T.functionName()}. This takes precedence
 * @property {boolean} [disableAutoStart] - An optional flag to disable the automatic start of the interval.
 */
export interface IntervalConfiguration<T extends Device> {
    functionName: keyof T & string;
    settingName?: string;
    intervalSeconds?: number;
    disableAutoStart?: boolean;
}

type ValueOf<T> = T[keyof T];

/**
 * Type definition for a collection of interval configurations, mapped by unique string keys.
 * Each entry in the collection is an {@link IntervalConfiguration} associated with a specific device type.
 *
 * @template T - Extends from the [Homey Device](https://apps-sdk-v3.developer.homey.app/Device.html) type, representing
 *  the device-specific configuration.
 */
export type IntervalConfigurationCollection<T extends Device> = Record<string, IntervalConfiguration<T>>;

type DeviceSettingsValue = string | number | boolean | undefined;
type DeviceSettings = Record<string, DeviceSettingsValue>;

/**
 * Manages intervals for a given Homey device, allowing for starting, stopping, and restarting
 * intervals based on configuration and device settings. This is useful for cases like when you need an
 * [OAuth2Device](https://athombv.github.io/node-homey-oauth2app/OAuth2Device.html) that polls multiple API endpoints in
 * the background.
 *
 * @template T - Extends from [Homey Device](https://apps-sdk-v3.developer.homey.app/Device.html).
 */
export class HomeyIntervalManager<T extends Device> {
    private managedIntervalIds: Record<string, NodeJS.Timeout | null> = {};
    private readonly device: T;
    private readonly intervalConfigs: IntervalConfigurationCollection<T>;
    private readonly debug: boolean;
    public readonly defaultIntervalSeconds: number;

    constructor(
        device: T,
        intervalConfigs: IntervalConfigurationCollection<T>,
        defaultIntervalSeconds = 600,
        debug: boolean = false,
    ) {
        this.device = device;
        this.intervalConfigs = intervalConfigs;
        this.defaultIntervalSeconds = Math.floor(defaultIntervalSeconds);
        this.debug = debug;

        if (this.debug) {
            this.device.log(
                `Configured interval manager for ${this.device.constructor.name} with default delay of`,
                `${this.defaultIntervalSeconds} configuration ${JSON.stringify(this.intervalConfigs, null, 2)}`,
            );
        }
    }

    /**
     * Checks if the given value is a number that is not NaN.
     *
     * @param {DeviceSettingsValue} value - The value to check.
     * @return {boolean} True if the value is a number that is not NaN, otherwise false.
     */
    private static isNumber(value: DeviceSettingsValue): value is number {
        return typeof value === "number" && !isNaN(value);
    }

    /**
     * Calculates the interval time in milliseconds based on the provided configuration and settings. The order of
     * precedence for determining the delay is user setting > interval config > manager default.
     *
     * @param {IntervalConfiguration<T>} config - The configuration object containing interval settings.
     * @param {DeviceSettings} settings - The settings object that may contain override values for intervals.
     * @return {number} The calculated interval in milliseconds.
     */
    private getIntervalMilliseconds(config: IntervalConfiguration<T>, settings: DeviceSettings): number {
        const settingValue = settings ? settings[config.settingName ?? ""] : undefined;
        const intervalSeconds = HomeyIntervalManager.isNumber(settingValue)
            ? settingValue
            : HomeyIntervalManager.isNumber(config.intervalSeconds)
              ? config.intervalSeconds
              : this.defaultIntervalSeconds;
        return intervalSeconds * 1000;
    }

    /**
     * Clears an active interval associated with the given key. The key must be that used in the
     * {@link IntervalConfigurationCollection}.
     *
     * @param {string} key - The unique key representing the interval to clear.
     * @return {Promise<void>} A promise that resolves once the interval has been cleared.
     */
    public async clearInterval(key: string): Promise<void> {
        const intervalId = this.managedIntervalIds[key];

        if (!intervalId) {
            if (this.debug) this.device.log(`Requested interval (${key}) not active, skipping`);
            return;
        }

        try {
            if (this.debug) this.device.log(`Stopping interval ${key}`);
            this.device.homey.clearInterval(intervalId);
        } catch (error) {
            this.device.error(`Error stopping interval ${key}:`, error);
        }

        this.managedIntervalIds[key] = null;
    }

    /**
     * Sets an interval identified by the given key and starts it. The key must be that used in the
     * {@link IntervalConfigurationCollection}.
     *
     * @param {string} key - The identifier for the interval to be set and started.
     * @return {Promise<void>} A promise that resolves once the interval has been started.
     */
    public async setInterval(key: string): Promise<void> {
        await this.start(key);
    }

    /**
     * Stops the intervals associated with the provided keys. If no keys are provided, all managed intervals are
     * cleared.
     *
     * @param {...string} keys - The keys for intervals that need to be stopped. If no keys are provided, all managed
     *  intervals will be stopped.
     * @return {Promise<void>} A promise that resolves when the intervals have been cleared.
     */
    public async stop(...keys: string[]): Promise<void> {
        for (const key of keys.length === 0 ? Object.keys(this.managedIntervalIds) : keys) {
            await this.clearInterval(key);
        }
    }

    /**
     * Checks if a given key is active.
     *
     * @param {string} key - The key to check.
     * @return {boolean} Returns true if active, otherwise false.
     */
    public isActive(key: string): boolean {
        return !!this.managedIntervalIds[key];
    }

    /**
     * Starts the specified intervals (by keys) or all managed intervals if no keys are provided.
     *
     * @param {...string} keys - The interval keys to start. If no keys are provided, all managed intervals are started.
     * @return {Promise<void>} A promise that resolves when the intervals have been started.
     */
    public async start(...keys: string[]): Promise<void> {
        const settings = this.device.getSettings();

        const isAutoStart = keys.length === 0;
        const restartKeys = isAutoStart ? Object.keys(this.intervalConfigs) : keys;

        for (const key of restartKeys) {
            if (this.isActive(key)) continue;

            const config = this.intervalConfigs[key];

            if (isAutoStart && config.disableAutoStart) continue;

            const intervalMs = this.getIntervalMilliseconds(config, settings);

            const intervalFn = this.device[config.functionName] as unknown as () => Promise<void>;

            if (typeof intervalFn !== "function") {
                if (this.debug)
                    this.device.log(
                        `Defined interval function (${config.functionName}) for ${key} is not a function, skipping`,
                    );
                continue;
            }

            if (this.debug)
                this.device.log(`Starting ${key} (${config.functionName}) with an interval of ${intervalMs} ms`);

            await intervalFn.apply(this.device).catch(this.device.error);

            this.managedIntervalIds[key] = this.device.homey.setInterval(async (): Promise<void> => {
                if (this.debug) this.device.log(`Executing scheduled run ${key} (${config.functionName})`);
                await intervalFn.apply(this.device).catch(this.device.error);
            }, intervalMs);
        }
    }

    /**
     * Restarts the services or processes identified by the given keys.
     *
     * @param {...string} keys - The keys identifying the services or processes to restart.
     * @return {Promise<void>} - A promise that resolves when the restart operation is complete.
     */
    public async restart(...keys: string[]): Promise<void> {
        await this.stop(...keys);
        await this.start(...keys);
    }

    /**
     * Restarts intervals based on a specific configuration key and its values.
     *
     * @param {keyof IntervalConfiguration<T>} configKey - The configuration key to match.
     * @param {...ValueOf<IntervalConfiguration<T>>[]} values - The values to match against the configuration key.
     * @return {Promise<void>} A promise that resolves when the intervals have been restarted.
     */
    private async restartByConfigKey(
        configKey: keyof IntervalConfiguration<T>,
        ...values: ValueOf<IntervalConfiguration<T>>[]
    ): Promise<void> {
        const { intervalConfigs } = this;
        const restartKeys: string[] = [];

        for (const [key, config] of Object.entries(intervalConfigs)) {
            const value = config[configKey];

            if (value && values.includes(config[configKey])) {
                restartKeys.push(key);
            }
        }

        await this.restart(...restartKeys);
    }

    /**
     * Restarts intervals that have been configured with the provided setting names. This is useful for use with
     * [`Device.onSettings`](https://apps-sdk-v3.developer.homey.app/Device.html#onSettings).
     *
     * @example
     * ```ts
     * async onSettings(event) {
     *  // ... your normal event handling
     *
     *  // trigger this a second later to allow homey to persist the new configurations after this method ends
     *  this.homey.setTimeout(async () => {
     *      await this.intervalManager.restartBySettings(...event.changedKeys);
     *  }, 1000);
     * }
     * ```
     *
     * @param {...string} settingNames - The names of the settings to restart the system by.
     * @return {Promise<void>} - A promise that resolves when the restart operation is complete.
     */
    public async restartBySettings(...settingNames: string[]): Promise<void> {
        await this.restartByConfigKey("settingName", ...settingNames);
    }

    /**
     * Restarts intervals that have been configured with the provided function names.
     *
     * @param {string[]} functionNames - The names of the functions to restart intervals for.
     * @return {Promise<void>} A promise that resolves when the restart process is complete.
     */
    public async restartByFunctionName(...functionNames: string[]): Promise<void> {
        await this.restartByConfigKey("functionName", ...functionNames);
    }
}
