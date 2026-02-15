import { NetworkService } from './NetworkService';
import NetInfo from '@react-native-community/netinfo';
import { Platform } from 'react-native';

// Mock NetInfo
jest.mock('@react-native-community/netinfo', () => ({
    fetch: jest.fn(),
    addEventListener: jest.fn(() => jest.fn()), // Return unsubscribe fn
}));

describe('NetworkService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('isConnectedToWifi', () => {
        it('should return true if connected to wifi', async () => {
            NetInfo.fetch.mockResolvedValue({ type: 'wifi', isConnected: true });
            const result = await NetworkService.isConnectedToWifi();
            expect(result).toBe(true);
        });

        it('should return false if not connected', async () => {
            NetInfo.fetch.mockResolvedValue({ type: 'none', isConnected: false });
            const result = await NetworkService.isConnectedToWifi();
            expect(result).toBe(false);
        });

        it('should return false if connected to cellular', async () => {
            NetInfo.fetch.mockResolvedValue({ type: 'cellular', isConnected: true });
            const result = await NetworkService.isConnectedToWifi();
            expect(result).toBe(false);
        });
    });

    describe('isConnectedToTargetNetwork', () => {
        it('should return false if no target SSID set', async () => {
            NetInfo.fetch.mockResolvedValue({ type: 'wifi', isConnected: true });
            // Should return false immediately
            const result = await NetworkService.isConnectedToTargetNetwork(null);
            expect(result).toBe(false);
        });

        // NOTE: We cannot easily mock Platform.OS in Jest standard env without
        // some specific hack or using jest-expo preset's platform specific extensions.
        // For simplicity, we will skip platform specific branching tests here 
        // or attempt to define Property if configurable.
        // React Native's Platform.OS is a getter.

        it('should attempt SSID match (Mock Android)', async () => {
            // Mock Platform.OS
            Object.defineProperty(Platform, 'OS', { get: () => 'android', configurable: true });

            NetInfo.fetch.mockResolvedValue({
                type: 'wifi',
                isConnected: true,
                details: { ssid: '"MyWiFi"' } // Quoted SSID
            });

            const result = await NetworkService.isConnectedToTargetNetwork('MyWiFi');
            expect(result).toBe(true);
        });

        it('should fail SSID match (Mock Android)', async () => {
            Object.defineProperty(Platform, 'OS', { get: () => 'android', configurable: true });

            NetInfo.fetch.mockResolvedValue({
                type: 'wifi',
                isConnected: true,
                details: { ssid: '"OtherWiFi"' }
            });

            const result = await NetworkService.isConnectedToTargetNetwork('MyWiFi');
            expect(result).toBe(false);
        });

        it('should return true on iOS (fallback)', async () => {
            Object.defineProperty(Platform, 'OS', { get: () => 'ios', configurable: true });

            NetInfo.fetch.mockResolvedValue({
                type: 'wifi',
                isConnected: true,
                details: {} // No SSID info
            });

            const result = await NetworkService.isConnectedToTargetNetwork('MyWiFi');
            expect(result).toBe(true);
        });
    });
});
