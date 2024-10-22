import type { Device } from "homey";

import { mock, MockProxy } from "jest-mock-extended";

import { HomeyIntervalManager, IntervalConfigurationCollection } from "../src/homey-interval-manager";

jest.useFakeTimers();
jest.spyOn(global, "setInterval");
jest.spyOn(global, "clearInterval");

interface MockedDevice extends Device {
    mockFunction1(): Promise<void>;

    mockFunction2(): Promise<void>;

    mockFunction3(): Promise<void>;
}

async function mockError(): Promise<never> {
    throw new Error();
}

describe("HomeyIntervalManager", () => {
    const defaultIntervalSeconds = 10;
    let device: MockProxy<MockedDevice>;

    beforeEach(() => {
        device = mock<MockedDevice>({
            log: console.log,
        });
        device.homey = mock<Device.Homey>({
            setInterval: setInterval,
            clearInterval: clearInterval,
        });

        device.mockFunction1.mockReturnValue(Promise.resolve());
        device.mockFunction2.mockReturnValue(Promise.resolve());
        device.mockFunction3.mockReturnValue(Promise.resolve());
    });

    afterEach(() => {
        jest.clearAllTimers();
        jest.clearAllMocks();
    });

    async function checkStarted(
        configs: IntervalConfigurationCollection<MockedDevice>,
        intervalManager: HomeyIntervalManager<MockedDevice>,
    ) {
        let idx = 0;

        for (const [key, config] of Object.entries(configs)) {
            expect(device[config.functionName]).toHaveBeenCalledTimes(config.disableAutoStart ? 0 : 1);

            if (config.disableAutoStart) {
                expect(intervalManager.isActive(key)).toBe(false);
                continue;
            }

            idx += 1;
            expect(device.homey.setInterval).toHaveBeenNthCalledWith(
                idx,
                expect.any(Function),
                (config.intervalSeconds ?? intervalManager.defaultIntervalSeconds) * 1000,
            );
            expect(intervalManager.isActive(key)).toBe(true);
        }

        expect(device.homey.setInterval).toHaveBeenCalledTimes(idx);
    }

    it("should start intervals with configured times", async () => {
        const configs: IntervalConfigurationCollection<MockedDevice> = {
            interval1: { functionName: "mockFunction1" },
            interval2: { functionName: "mockFunction2", intervalSeconds: defaultIntervalSeconds * 2 },
        };
        const intervalManager = new HomeyIntervalManager<MockedDevice>(device, configs, defaultIntervalSeconds);

        await intervalManager.start();
        await checkStarted(configs, intervalManager);

        // trigger interval1
        jest.advanceTimersByTime(defaultIntervalSeconds * 1000);
        expect(device.mockFunction1).toHaveBeenCalledTimes(2);
        expect(device.mockFunction2).toHaveBeenCalledTimes(1);

        // trigger interval2
        jest.advanceTimersByTime(defaultIntervalSeconds * 1000);
        expect(device.mockFunction1).toHaveBeenCalledTimes(3);
        expect(device.mockFunction2).toHaveBeenCalledTimes(2);

        await intervalManager.stop();
    });

    it("should handle intermittent errors", async () => {
        const configs: IntervalConfigurationCollection<MockedDevice> = {
            interval1: { functionName: "mockFunction1" },
        };
        const intervalManager = new HomeyIntervalManager<MockedDevice>(device, configs, defaultIntervalSeconds);

        // raise an error once
        device.mockFunction1.mockImplementationOnce(mockError);

        await intervalManager.start();
        await checkStarted(configs, intervalManager);

        // error was handled correctly
        expect(device.error).toHaveBeenCalledTimes(1);

        // trigger scheduled run
        jest.advanceTimersByTime(defaultIntervalSeconds * 1000);
        expect(device.mockFunction1).toHaveBeenCalledTimes(2);
        expect(device.error).toHaveBeenCalledTimes(1);

        await intervalManager.stop();
    });

    it("should use default interval when none specified", async () => {
        const configs: IntervalConfigurationCollection<MockedDevice> = {
            interval1: { functionName: "mockFunction1" },
        };
        const intervalManager = new HomeyIntervalManager<MockedDevice>(device, configs, 9999);

        await intervalManager.start();
        await checkStarted(configs, intervalManager);

        expect(device.homey.setInterval).toHaveBeenCalledTimes(1);
        expect(device.homey.setInterval).toHaveBeenNthCalledWith(1, expect.any(Function), 9999 * 1000);

        await intervalManager.stop();
    });

    it("should respect disableAutostart configuration", async () => {
        const configs: IntervalConfigurationCollection<MockedDevice> = {
            interval1: { functionName: "mockFunction1" },
            interval2: { functionName: "mockFunction2", intervalSeconds: 20 },
            interval3: { functionName: "mockFunction3", intervalSeconds: 30, disableAutoStart: true },
        };
        const intervalManager = new HomeyIntervalManager<MockedDevice>(device, configs, defaultIntervalSeconds);

        await intervalManager.start();
        await checkStarted(configs, intervalManager);

        expect(device.mockFunction3).toHaveBeenCalledTimes(0);
        expect(intervalManager.isActive("interval3")).toBe(false);

        await intervalManager.stop();
    });

    it("should stop all runs on stop()", async () => {
        const configs: IntervalConfigurationCollection<MockedDevice> = {
            interval1: { functionName: "mockFunction1" },
            interval2: { functionName: "mockFunction2", intervalSeconds: defaultIntervalSeconds * 2 },
        };
        const intervalManager = new HomeyIntervalManager<MockedDevice>(device, configs, defaultIntervalSeconds);

        await intervalManager.start();
        await checkStarted(configs, intervalManager);

        // trigger interval1
        jest.advanceTimersByTime(defaultIntervalSeconds * 1000);
        expect(device.mockFunction1).toHaveBeenCalledTimes(2);
        expect(device.mockFunction2).toHaveBeenCalledTimes(1);

        // trigger interval2
        jest.advanceTimersByTime(defaultIntervalSeconds * 1000);
        expect(device.mockFunction1).toHaveBeenCalledTimes(3);
        expect(device.mockFunction2).toHaveBeenCalledTimes(2);

        await intervalManager.stop();

        expect(device.homey.setInterval).toHaveBeenCalledTimes(2);

        expect(intervalManager.isActive("interval1")).toBe(false);
        expect(intervalManager.isActive("interval2")).toBe(false);

        // should not be called again
        jest.advanceTimersByTime(defaultIntervalSeconds * 1000);
        expect(device.mockFunction1).toHaveBeenCalledTimes(3);
        expect(device.mockFunction2).toHaveBeenCalledTimes(2);

        jest.runOnlyPendingTimers();
        expect(device.mockFunction1).toHaveBeenCalledTimes(3);
        expect(device.mockFunction2).toHaveBeenCalledTimes(2);
    });

    it("should use interval time value from setting", async () => {
        const configs: IntervalConfigurationCollection<MockedDevice> = {
            interval1: { functionName: "mockFunction1", settingName: "setting1" },
        };
        const intervalManager = new HomeyIntervalManager<MockedDevice>(device, configs, defaultIntervalSeconds);

        const setting1: number = defaultIntervalSeconds * 2;
        device.getSettings.mockReturnValue({
            setting1: setting1,
            setting2: setting1 * 2,
        });

        await intervalManager.start();

        expect(device.mockFunction1).toHaveBeenCalledTimes(1);

        expect(device.homey.setInterval).toHaveBeenCalledTimes(1);
        expect(device.homey.setInterval).toHaveBeenNthCalledWith(1, expect.any(Function), setting1 * 1000);

        jest.advanceTimersByTime(defaultIntervalSeconds * 1000);
        expect(device.mockFunction1).toHaveBeenCalledTimes(1);

        jest.advanceTimersByTime(defaultIntervalSeconds * 1000);
        expect(device.mockFunction1).toHaveBeenCalledTimes(2);

        jest.advanceTimersByTime(setting1 * 1000);
        expect(device.mockFunction1).toHaveBeenCalledTimes(3);

        await intervalManager.stop();
    });

    it("should use default when setting value is empty", async () => {
        const configs: IntervalConfigurationCollection<MockedDevice> = {
            emptySetting: { functionName: "mockFunction1", settingName: "setting1" },
        };
        const intervalManager = new HomeyIntervalManager<MockedDevice>(device, configs, defaultIntervalSeconds);

        device.getSettings.mockReturnValue({
            setting1: "",
        });

        await intervalManager.start();

        expect(device.mockFunction1).toHaveBeenCalledTimes(1);

        expect(device.homey.setInterval).toHaveBeenCalledTimes(1);
        expect(device.homey.setInterval).toHaveBeenCalledWith(expect.any(Function), defaultIntervalSeconds * 1000);

        jest.advanceTimersByTime(defaultIntervalSeconds * 1000);
        expect(device.mockFunction1).toHaveBeenCalledTimes(2);

        await intervalManager.stop();
    });

    it("should use default when setting value is undefined", async () => {
        const configs: IntervalConfigurationCollection<MockedDevice> = {
            undefinedSetting: { functionName: "mockFunction1", settingName: "setting1" },
        };
        const intervalManager = new HomeyIntervalManager<MockedDevice>(device, configs, defaultIntervalSeconds);

        device.getSettings.mockReturnValue({
            setting2: 20,
        });

        await intervalManager.start();

        expect(device.mockFunction1).toHaveBeenCalledTimes(1);

        expect(device.homey.setInterval).toHaveBeenCalledTimes(1);
        expect(device.homey.setInterval).toHaveBeenCalledWith(expect.any(Function), defaultIntervalSeconds * 1000);

        jest.advanceTimersByTime(defaultIntervalSeconds * 1000);
        expect(device.mockFunction1).toHaveBeenCalledTimes(2);

        await intervalManager.stop();
    });

    it("should use default when setting value is undefined", async () => {
        const configs: IntervalConfigurationCollection<MockedDevice> = {
            interval1: { functionName: "mockFunction1", settingName: "setting1" },
            restartSetting: { functionName: "mockFunction2", settingName: "setting2" },
        };
        const intervalManager = new HomeyIntervalManager<MockedDevice>(device, configs, defaultIntervalSeconds);

        device.getSettings.mockReturnValue({
            setting1: 10,
            setting2: 20,
        });

        await intervalManager.start();

        expect(device.mockFunction1).toHaveBeenCalledTimes(1);
        expect(device.mockFunction2).toHaveBeenCalledTimes(1);

        expect(device.homey.setInterval).toHaveBeenCalledTimes(2);
        expect(device.homey.setInterval).toHaveBeenNthCalledWith(1, expect.any(Function), 10 * 1000);
        expect(device.homey.setInterval).toHaveBeenNthCalledWith(2, expect.any(Function), 20 * 1000);

        await intervalManager.restart("setting2");
        expect(device.mockFunction1).toHaveBeenCalledTimes(1);
        expect(device.mockFunction2).toHaveBeenCalledTimes(2);
        expect(device.homey.clearInterval).toHaveBeenCalledTimes(1);
        expect(device.homey.setInterval).toHaveBeenCalledTimes(3);
        expect(device.homey.setInterval).toHaveBeenNthCalledWith(3, expect.any(Function), 20 * 1000);

        await intervalManager.stop();
    });
});
