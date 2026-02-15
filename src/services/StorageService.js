import AsyncStorage from '@react-native-async-storage/async-storage';
import moment from 'moment';

const KEYS = {
    TARGET_SSID: 'TARGET_SSID', // User-friendly name (e.g. "Work")
    RAW_SSID: 'RAW_SSID',       // Actual SSID (e.g. "Cisco-5G")
    CURRENT_SESSION: 'CURRENT_SESSION',
    HISTORY: 'HISTORY',
    SESSIONS: 'SESSIONS', // Individual session details with start/end times
    GOAL_HOURS: 'GOAL_HOURS', // Configurable daily goal in hours (default 8.5)
};

export const StorageService = {
    // --- Target SSID (Display Name & Raw) ---
    setTargetSSID: async (name, rawSSID) => {
        try {
            if (!name) {
                await AsyncStorage.removeItem(KEYS.TARGET_SSID);
                await AsyncStorage.removeItem(KEYS.RAW_SSID);
            } else {
                await AsyncStorage.setItem(KEYS.TARGET_SSID, name);
                if (rawSSID) {
                    await AsyncStorage.setItem(KEYS.RAW_SSID, rawSSID.replace(/^"|"$/g, '')); // Remove quotes if present
                }
            }
        } catch (e) {
            console.error('Error saving SSID', e);
        }
    },

    getTargetSSID: async () => {
        try {
            return await AsyncStorage.getItem(KEYS.TARGET_SSID);
        } catch (e) {
            return null;
        }
    },

    getRawSSID: async () => {
        try {
            return await AsyncStorage.getItem(KEYS.RAW_SSID);
        } catch (e) {
            return null;
        }
    },

    clearTargetSSID: async () => {
        try {
            await AsyncStorage.removeItem(KEYS.TARGET_SSID);
            await AsyncStorage.removeItem(KEYS.RAW_SSID);
        } catch (e) {
            console.error('Error clearing SSID', e);
        }
    },

    // --- Goal Hours (configurable daily target) ---
    getGoalHours: async () => {
        try {
            const val = await AsyncStorage.getItem(KEYS.GOAL_HOURS);
            return val !== null ? parseFloat(val) : 8.5; // Default 8.5 hours
        } catch (e) {
            return 8.5;
        }
    },

    setGoalHours: async (hours) => {
        try {
            await AsyncStorage.setItem(KEYS.GOAL_HOURS, String(hours));
        } catch (e) {
            console.error('Error saving goal hours', e);
        }
    },

    // NEW: Persistent Manual Pause
    getManualPause: async () => {
        try {
            const val = await AsyncStorage.getItem('IS_MANUAL_PAUSED');
            return val === 'true';
        } catch (e) {
            return false;
        }
    },

    setManualPause: async (isPaused) => {
        try {
            await AsyncStorage.setItem('IS_MANUAL_PAUSED', isPaused ? 'true' : 'false');
        } catch (e) {
            console.error(e);
        }
    },

    // --- Session Management ---
    startSession: async () => {
        try {
            const now = Date.now();
            const session = { start: now, lastActive: now };
            await AsyncStorage.setItem(KEYS.CURRENT_SESSION, JSON.stringify(session));
            return session;
        } catch (e) {
            console.error('Error starting session', e);
        }
    },

    updateSessionHeartbeat: async () => {
        try {
            const json = await AsyncStorage.getItem(KEYS.CURRENT_SESSION);
            if (json) {
                const session = JSON.parse(json);
                session.lastActive = Date.now();
                await AsyncStorage.setItem(KEYS.CURRENT_SESSION, JSON.stringify(session));
                return session;
            }
        } catch (e) {
            console.error('Error updating session', e);
        }
        return null;
    },

    endSession: async () => {
        if (StorageService._isEnding) return;
        StorageService._isEnding = true;
        try {
            const json = await AsyncStorage.getItem(KEYS.CURRENT_SESSION);
            if (json) {
                const session = JSON.parse(json);

                const now = Date.now();
                session.lastActive = now;
                const startDay = moment(session.start).format('YYYY-MM-DD');
                const endDay = moment(now).format('YYYY-MM-DD');

                // Check if session spans across midnight
                if (startDay !== endDay) {
                    // Calculate midnight of start day
                    const midnight = moment(session.start).endOf('day').valueOf();

                    // Duration 1: Start -> Midnight (logged to start day)
                    const duration1 = midnight - session.start;
                    if (duration1 >= 1000) {
                        await StorageService.addToHistory(session.start, duration1);
                        await StorageService.addSessionDetail(session.start, midnight);
                    }

                    // Duration 2: Midnight -> Now (logged to end day)
                    // We treat the new segment as starting at midnight + 1ms
                    const startOfNewDay = midnight + 1;
                    const duration2 = now - startOfNewDay;

                    if (duration2 >= 1000) {
                        await StorageService.addToHistory(now, duration2);
                        await StorageService.addSessionDetail(startOfNewDay, now);
                    }
                } else {
                    // Normal single day session
                    const duration = session.lastActive - session.start;
                    // Only save sessions that are at least 1 second (1000 ms)
                    if (duration >= 1000) {
                        await StorageService.addToHistory(session.start, duration);
                        // Also save session details for timeline view
                        await StorageService.addSessionDetail(session.start, session.lastActive);
                    }
                }

                await AsyncStorage.removeItem(KEYS.CURRENT_SESSION);
            }
        } catch (e) {
            console.error('Error ending session', e);
        } finally {
            StorageService._isEnding = false;
        }
    },

    getCurrentSession: async () => {
        try {
            const json = await AsyncStorage.getItem(KEYS.CURRENT_SESSION);
            return json ? JSON.parse(json) : null;
        } catch (e) {
            return null;
        }
    },

    // --- History ---
    addToHistory: async (timestamp, durationMs) => {
        try {
            const dateKey = moment(timestamp).format('YYYY-MM-DD');
            const historyJson = await AsyncStorage.getItem(KEYS.HISTORY);
            const history = historyJson ? JSON.parse(historyJson) : {};

            const currentTotal = history[dateKey] || 0;
            history[dateKey] = currentTotal + durationMs;

            await AsyncStorage.setItem(KEYS.HISTORY, JSON.stringify(history));
        } catch (e) {
            console.error('Error adding to history', e);
        }
    },

    getHistory: async () => {
        try {
            const json = await AsyncStorage.getItem(KEYS.HISTORY);
            return json ? JSON.parse(json) : {};
        } catch (e) {
            return {};
        }
    },

    getTodayDuration: async () => {
        try {
            const dateKey = moment().format('YYYY-MM-DD');
            const historyJson = await AsyncStorage.getItem(KEYS.HISTORY);
            const history = historyJson ? JSON.parse(historyJson) : {};
            return history[dateKey] || 0;
        } catch (e) {
            return 0;
        }
    },

    clearHistory: async () => {
        await AsyncStorage.removeItem(KEYS.HISTORY);
        await AsyncStorage.removeItem(KEYS.SESSIONS); // Also clear session details
    },

    // --- Session Details (for timeline view) ---
    addSessionDetail: async (startTime, endTime) => {
        try {
            const dateKey = moment(startTime).format('YYYY-MM-DD');
            const sessionsJson = await AsyncStorage.getItem(KEYS.SESSIONS);
            const allSessions = sessionsJson ? JSON.parse(sessionsJson) : {};

            if (!allSessions[dateKey]) {
                allSessions[dateKey] = [];
            }

            allSessions[dateKey].push({
                start: startTime,
                end: endTime,
                duration: endTime - startTime
            });

            await AsyncStorage.setItem(KEYS.SESSIONS, JSON.stringify(allSessions));
        } catch (e) {
            console.error('Error adding session detail', e);
        }
    },

    getTodaySessions: async () => {
        try {
            const dateKey = moment().format('YYYY-MM-DD');
            const sessionsJson = await AsyncStorage.getItem(KEYS.SESSIONS);
            const allSessions = sessionsJson ? JSON.parse(sessionsJson) : {};
            return allSessions[dateKey] || [];
        } catch (e) {
            return [];
        }
    },

    // --- Date-parameterized lookups (for historical view) ---
    getSessionsForDate: async (dateKey) => {
        try {
            const sessionsJson = await AsyncStorage.getItem(KEYS.SESSIONS);
            const allSessions = sessionsJson ? JSON.parse(sessionsJson) : {};
            return allSessions[dateKey] || [];
        } catch (e) {
            return [];
        }
    },

    getDurationForDate: async (dateKey) => {
        try {
            const historyJson = await AsyncStorage.getItem(KEYS.HISTORY);
            const history = historyJson ? JSON.parse(historyJson) : {};
            return history[dateKey] || 0;
        } catch (e) {
            return 0;
        }
    }
};
