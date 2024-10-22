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
     * Stops all managed intervals by clearing each one.
     *
     * Iterates over all interval IDs managed by the instance,
     * and clears each interval using the clearInterval method.
     *
     * @return {Promise<void>} A promise that resolves when all intervals have been cleared.
     */
    public async stop(): Promise<void> {
        for (const key of Object.keys(this.managedIntervalIds)) {
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
     * Restarts the service, optionally considering changed settings.
     *
     * @param {...string} changedSettings - An array of settings that have changed.
     * @return {Promise<void>} A promise that resolves when the restart operation is complete.
     */
    public async restart(...changedSettings: string[]): Promise<void> {
        if (changedSettings.length === 0) {
            await this.stop();
            await this.start();
            return;
        }

        const { intervalConfigs } = this;
        const restartKeys: string[] = [];

        for (const key of Object.keys(intervalConfigs)) {
            const config = intervalConfigs[key];

            if (config.settingName && changedSettings.includes(config.settingName)) {
                await this.clearInterval(key);
                restartKeys.push(key);
            }
        }

        await this.start(...restartKeys);
    }
}
