import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const BACKGROUND_TASK_NAME = 'BACKGROUND_WIFI_MONITOR';

/**
 * ForegroundService - Manages persistent background tracking
 * 
 * This service ensures the app continues tracking office hours even when:
 * - App is closed
 * - App is removed from recent apps
 * - Device is rebooted (Android)
 */
class ForegroundServiceManager {
    constructor() {
        this.isServiceRunning = false;
        this.isAskingPermissions = false; // Flag to prevent resume loops
        this.notificationId = 'intime-foreground-service';
    }

    /**
     * Explicitly check and allow system to prompt for Location Services
     * Returns true if enabled/enabled by user, false if denied.
     */
    async ensureLocationServicesEnabled() {
        try {
            // 1. Request Foreground Permissions first
            const { status: foregroundStatus } = await Location.getForegroundPermissionsAsync();

            // If not granted, request them
            if (foregroundStatus !== 'granted') {
                const { status: newStatus } = await Location.requestForegroundPermissionsAsync();
                if (newStatus !== 'granted') return false;
            }

            // 2. CHECK IF LOCATION SERVICES ARE ACTUALLY ENABLED (GPS)
            const providerStatus = await Location.getProviderStatusAsync();
            if (!providerStatus.locationServicesEnabled) {
                // Trigger system dialog to enable location services
                try {
                    await Location.getCurrentPositionAsync({
                        accuracy: Location.Accuracy.Balanced,
                        timeout: 5000 // 5 second timeout
                    });
                    // GPS was enabled successfully
                    return true;
                } catch (e) {
                    console.warn('User did not enable location services or timeout:', e);
                    return false;
                }
            }
            return true;
        } catch (e) {
            console.error("Error ensuring location services:", e);
            return false;
        }
    }

    /**
     * Start the persistent foreground service
     */
    async startService() {
        // Prevent re-entry if already asking permissions (Fixes resume loop)
        if (this.isAskingPermissions) {
            console.log("Already asking for permissions, skipping startService on resume.");
            return false;
        }

        // SET LOCK IMMEDIATELY to prevent AppState listener from re-triggering
        this.isAskingPermissions = true;

        // ALWAYS check location status/permissions before checking isServiceRunning.
        // This ensures that even if service is "running", we re-verify GPS is on.
        const isLocationReady = await this.ensureLocationServicesEnabled();
        if (!isLocationReady) {
            console.log("Location services not ready, cannot start/resume tracking.");
            this.isAskingPermissions = false; // UNLOCK on failure
            return false;
        }

        if (this.isServiceRunning) {
            console.log('Service already running');
            this.isAskingPermissions = false; // UNLOCK
            return true;
        }

        try {

            // Permissions are already checked in ensureLocationServicesEnabled, 
            // but we double check or just proceed to background/notif permissions.

            // 3. SKIP Background Permissions to avoid Settings page navigation
            // Background permission is nice-to-have but not critical for basic tracking
            // User can grant it manually if needed
            console.log('Skipping background permission request to avoid Settings navigation');

            // 4. Request Notification Permissions
            const { status: notificationStatus } = await Notifications.requestPermissionsAsync();

            if (notificationStatus !== 'granted') {
                console.warn('Notification permission not granted');
            }

            // Create persistent notification channel (Android)
            if (Platform.OS === 'android') {
                await Notifications.setNotificationChannelAsync('foreground-service', {
                    name: 'Background Tracking Service',
                    importance: Notifications.AndroidImportance.HIGH,
                    sound: null,
                    vibrationPattern: null,
                    enableVibrate: false,
                    enableLights: false,
                    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
                    bypassDnd: false,
                });
            }

            // Start location updates with foreground service
            await Location.startLocationUpdatesAsync(BACKGROUND_TASK_NAME, {
                accuracy: Location.Accuracy.Balanced,
                timeInterval: 60000, // Check every 60 seconds
                distanceInterval: 0, // Don't require movement
                showsBackgroundLocationIndicator: true,
                pausesUpdatesAutomatically: false,
                deferredUpdatesInterval: 60000,
                foregroundService: {
                    notificationTitle: "⏱️ InTime - Tracking",
                    notificationBody: "Automatically tracking your office hours",
                    // notificationColor removed to use default system color
                    killServiceOnDestroy: false, // CRITICAL: Keep service alive
                },
            });

            this.isServiceRunning = true;
            this.isAskingPermissions = false; // UNLOCK
            console.log('Foreground service started successfully');
            return true;

        } catch (error) {
            console.error('Failed to start foreground service:', error);
            this.isAskingPermissions = false; // UNLOCK on error
            return false;
        }
    }

    /**
     * Stop the foreground service
     */
    async stopService() {
        try {
            const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASK_NAME);
            if (isRegistered) {
                await Location.stopLocationUpdatesAsync(BACKGROUND_TASK_NAME);
                this.isServiceRunning = false;
                console.log('Foreground service stopped');
                return true;
            }
        } catch (error) {
            console.error('Failed to stop foreground service:', error);
            return false;
        }
    }

    /**
     * Check if service is currently running
     */
    async isRunning() {
        try {
            const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASK_NAME);
            this.isServiceRunning = isRegistered;
            return isRegistered;
        } catch (error) {
            console.error('Failed to check service status:', error);
            return false;
        }
    }

    /**
     * Request battery optimization exemption (Android)
     */
    async requestBatteryOptimizationExemption() {
        if (Platform.OS === 'android') {
            try {
                const { Linking } = require('react-native');
                await Linking.sendIntent('android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS', [
                    { key: 'package', value: 'com.lbndvs.officetimetracker' }
                ]);
                return true;
            } catch (error) {
                console.error('Failed to request battery optimization exemption:', error);
                // Fallback to general battery settings
                try {
                    const { Linking } = require('react-native');
                    await Linking.sendIntent('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS');
                } catch (fallbackError) {
                    console.error('Fallback also failed:', fallbackError);
                }
                return false;
            }
        }
        return false;
    }

    /**
     * Restart service (useful after app updates or crashes)
     */
    async restartService() {
        await this.stopService();
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
        return await this.startService();
    }
}

// Export singleton instance
export const ForegroundService = new ForegroundServiceManager();
