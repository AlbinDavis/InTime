import NetInfo from '@react-native-community/netinfo';
import { Platform } from 'react-native';

/**
 * NetworkService - Handles SSID detection and network matching
 * 
 * This service provides SSID-specific network detection:
 * - Android: Full SSID matching support
 * - iOS: Limited support (falls back to generic Wi-Fi detection)
 */
class NetworkServiceManager {
    constructor() {
        this.currentState = null;
    }

    /**
     * Get current network SSID
     * @returns {Promise<string|null>} SSID name or null if not available
     */
    async getCurrentSSID() {
        try {
            const state = await NetInfo.fetch();

            // Check if connected to Wi-Fi
            if (state.type !== 'wifi') {
                return null;
            }

            // Android: Check if location services are enabled FIRST
            // Without location, SSID access is not reliable (even if NetInfo returns cached value)
            if (Platform.OS === 'android') {
                try {
                    // Import Location dynamically to avoid circular dependencies
                    const Location = require('expo-location');
                    const providerStatus = await Location.getProviderStatusAsync();

                    if (!providerStatus.locationServicesEnabled) {
                        console.log('getCurrentSSID: Location disabled, cannot reliably get SSID');
                        return null;
                    }
                } catch (locError) {
                    console.warn('getCurrentSSID: Could not check location status', locError);
                    // Continue anyway - might work on older Android versions
                }
            }

            // Android: SSID is available in details (if location enabled)
            if (Platform.OS === 'android' && state.details?.ssid) {
                // Remove quotes if present (some devices return "SSID" with quotes)
                return state.details.ssid.replace(/^"|"$/g, '');
            }

            // iOS: SSID is restricted on iOS 13+
            // Returns null unless app has "Access WiFi Information" entitlement
            if (Platform.OS === 'ios' && state.details?.ssid) {
                return state.details.ssid.replace(/^"|"$/g, '');
            }

            // SSID not available (iOS limitation or not connected)
            return null;
        } catch (error) {
            console.error('Error getting current SSID:', error);
            return null;
        }
    }

    /**
     * Check if connected to a specific target network
     * @param {string} targetSSID - The SSID to match against
     * @returns {Promise<boolean>} true if connected to target network
     */
    async isConnectedToTargetNetwork(targetSSID) {
        try {
            const state = await NetInfo.fetch();

            // Not connected to Wi-Fi at all
            if (state.type !== 'wifi' || !state.isConnected) {
                return false;
            }

            // If no target SSID is set, return false
            if (!targetSSID) {
                return false;
            }

            // Android: Check actual SSID
            if (Platform.OS === 'android') {
                const currentSSID = await this.getCurrentSSID();

                if (!currentSSID) {
                    // SSID not available - Location permission required on Android
                    // Cannot match without SSID, so return false
                    console.warn('Cannot get SSID - location permission may be disabled');
                    return false; // FIXED: Don't track without SSID verification
                }

                // Exact SSID match
                return currentSSID === targetSSID;
            }

            // iOS: Try to get SSID, but likely will be null
            if (Platform.OS === 'ios') {
                const currentSSID = await this.getCurrentSSID();

                if (currentSSID) {
                    // If we somehow got the SSID (rare), use exact match
                    return currentSSID === targetSSID;
                }

                // iOS limitation: SSID not available
                // Fallback to generic Wi-Fi detection
                console.log('iOS SSID not available, using generic Wi-Fi detection');
                return true; // Any Wi-Fi = match (iOS limitation)
            }

            return false;
        } catch (error) {
            console.error('Error checking target network:', error);
            return false;
        }
    }

    /**
     * Get full network information
     * @returns {Promise<Object>} Network state object
     */
    async getNetworkInfo() {
        try {
            const state = await NetInfo.fetch();
            this.currentState = state;

            return {
                type: state.type,
                isConnected: state.isConnected,
                isWifi: state.type === 'wifi',
                ssid: await this.getCurrentSSID(),
                details: state.details,
            };
        } catch (error) {
            console.error('Error getting network info:', error);
            return {
                type: 'unknown',
                isConnected: false,
                isWifi: false,
                ssid: null,
                details: null,
            };
        }
    }

    /**
     * Check if device is connected to any Wi-Fi network
     * @returns {Promise<boolean>} true if connected to Wi-Fi
     */
    async isConnectedToWifi() {
        try {
            const state = await NetInfo.fetch();
            return state.type === 'wifi' && state.isConnected;
        } catch (error) {
            console.error('Error checking Wi-Fi connection:', error);
            return false;
        }
    }

    /**
     * Subscribe to network state changes
     * @param {Function} callback - Called when network state changes
     * @returns {Function} Unsubscribe function
     */
    subscribeToNetworkChanges(callback) {
        return NetInfo.addEventListener(state => {
            this.currentState = state;
            callback(state);
        });
    }
}

// Export singleton instance
export const NetworkService = new NetworkServiceManager();
