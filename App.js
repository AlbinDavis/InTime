import React, { useEffect, useState, useCallback } from 'react';
import { Text, View, TouchableOpacity, ScrollView, Alert, RefreshControl, useColorScheme, StatusBar, Platform, Linking, Modal, TextInput, Dimensions, SafeAreaView, AppState, StyleSheet } from 'react-native';
import * as Network from 'expo-network';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import moment from 'moment';
import CircularProgress from 'react-native-circular-progress-indicator';
import { Calendar } from 'react-native-calendars';
import { Ionicons } from '@expo/vector-icons';
import { StorageService } from './src/services/StorageService';
import { NetworkService } from './src/services/NetworkService';
import WidgetService from './src/services/WidgetService';
import { styles } from './src/styles/AppStyles';

const BACKGROUND_TASK_NAME = 'BACKGROUND_WIFI_MONITOR';

const { width } = Dimensions.get('window');
// Dynamic Ring Size: 35% of screen width (e.g. 130px on iPhone 12, 112px on SE)
const RING_RADIUS = width * 0.35;

// Configure Notifications
Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
    }),
});

TaskManager.defineTask(BACKGROUND_TASK_NAME, async ({ data, error }) => {
    if (error) return;
    if (data) {
        try {
            const targetSSID = await StorageService.getTargetSSID();
            const storedSSID = await StorageService.getRawSSID();
            const isManualPaused = await StorageService.getManualPause(); // Read Pause State

            if (!targetSSID || isManualPaused) return; // Prevent BG from starting session if paused

            // Import NetworkService dynamically
            const { NetworkService } = await import('./src/services/NetworkService');

            const isWifi = await NetworkService.isConnectedToWifi();

            let isOffice = false;
            if (isWifi) {
                if (storedSSID) {
                    // Use SSID matching
                    isOffice = await NetworkService.isConnectedToTargetNetwork(storedSSID);
                } else {
                    // No SSID stored (legacy or iOS), use generic Wi-Fi detection
                    isOffice = true;
                }
            }

            if (isOffice) {
                const currentSession = await StorageService.getCurrentSession();
                if (currentSession) {
                    await StorageService.updateSessionHeartbeat();
                } else {
                    await StorageService.startSession();
                }
            } else {
                await StorageService.endSession();
            }
        } catch (err) {
            console.error("Bg task error", err);
        }
    }
});

export default function App() {
    const colorScheme = useColorScheme();
    const isDark = colorScheme === 'dark';

    const colors = {
        bg: isDark ? '#121212' : '#F7F8FA',
        card: isDark ? '#1E1E1E' : '#FFFFFF',
        text: isDark ? '#E0E0E0' : '#1a1a1a',
        subText: isDark ? '#A0A0A0' : '#888888',
        accent: '#4CAF50',
        calendarBg: isDark ? '#1E1E1E' : '#FFFFFF',
        calendarText: isDark ? '#E0E0E0' : '#2D4150',
        inputBg: isDark ? '#2C2C2C' : '#F0F0F0',
        divider: isDark ? '#333' : '#eee',
    };

    const [targetSSID, setTargetSSID] = useState(null);
    const [currentSSIDName, setCurrentSSIDName] = useState(null);
    const [isConnectedToOffice, setIsConnectedToOffice] = useState(false);
    const [isOnTargetNetwork, setIsOnTargetNetwork] = useState(false); // NEW: Track if on correct network
    const [sessionDuration, setSessionDuration] = useState(0);
    const [todayTotal, setTodayTotal] = useState(0);
    const [history, setHistory] = useState({});
    const [todaySessions, setTodaySessions] = useState([]);
    const [weeklyData, setWeeklyData] = useState([]);
    const [refreshing, setRefreshing] = useState(false);
    const [isManualStop, setIsManualStop] = useState(false); // NEW: Manual Stop State

    // Calendar Date Selection State
    const [selectedDate, setSelectedDate] = useState(null); // null = live/today view
    const [selectedDateTotal, setSelectedDateTotal] = useState(0);
    const [selectedDateSessions, setSelectedDateSessions] = useState([]);
    const [selectedWeekData, setSelectedWeekData] = useState([]);

    // Modal State
    const [modalVisible, setModalVisible] = useState(false);
    const [wifiNameInput, setWifiNameInput] = useState('');
    const [goalHoursInput, setGoalHoursInput] = useState(''); // Goal time input for modal
    const [capturedSSID, setCapturedSSID] = useState(null); // Captured SSID
    const [modalTitle, setModalTitle] = useState('Rename Wi-Fi Name'); // Dynamic Title

    // Goal Hours State
    const [goalHours, setGoalHoursState] = useState(8.5);

    // Current Session Start (for instant start time display)
    const [currentSessionStart, setCurrentSessionStart] = useState(null);

    // Success Modal State
    const [successVisible, setSuccessVisible] = useState(false);
    const [successData, setSuccessData] = useState({ title: '', message: '' });

    const handleSuccessClose = () => {
        setSuccessVisible(false);
    };

    const showSuccess = (title, message) => {
        setSuccessData({ title, message });
        setSuccessVisible(true);
    };

    useEffect(() => {
        init();
        const interval = setInterval(tick, 1000); // 1s tick

        // Listen for App Resume to re-check location services AND refresh data
        const subscription = AppState.addEventListener('change', async (nextAppState) => {
            if (nextAppState === 'active') {
                console.log('App resumed - refreshing data and checking services...');

                // Auto-refresh data when app comes to foreground
                await refreshTotals();
                await checkNetworkAndSession();

                // Check location services and foreground service
                const { ForegroundService } = await import('./src/services/ForegroundService');
                await ForegroundService.startService();
            }
        });

        return () => {
            clearInterval(interval);
            subscription.remove();
        };
    }, []);

    const init = async () => {
        // Start persistent foreground service
        const { ForegroundService } = await import('./src/services/ForegroundService');
        await ForegroundService.startService();
        // Permission dialogs are handled automatically by the system

        await Notifications.requestPermissionsAsync();
        scheduleDailyReminder();

        const storedSSID = await StorageService.getTargetSSID();
        setTargetSSID(storedSSID);

        // Load configurable goal hours
        const storedGoal = await StorageService.getGoalHours();
        setGoalHoursState(storedGoal);

        await refreshTotals(); // Load all data including weekly histogram and sessions
    };

    const scheduleDailyReminder = async () => {
        await Notifications.cancelAllScheduledNotificationsAsync();
        await Notifications.scheduleNotificationAsync({
            content: {
                title: "Good Morning! ☀️",
                body: "Enable Wi-Fi to start tracking your office hours.",
            },
            trigger: {
                hour: 9,
                minute: 0,
                repeats: true,
            },
        });
    };

    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        await refreshTotals(); // Use refreshTotals to get all data
        setRefreshing(false);
    }, []);

    const checkNetworkAndSession = async () => {
        try {
            const isWifi = await NetworkService.isConnectedToWifi();

            let newIsConnected = false;
            let newSSIDName = "Not Connected";

            if (isWifi) {
                newSSIDName = "Wi-Fi Connected";
            }

            const storedTarget = await StorageService.getTargetSSID();
            const storedSSID = await StorageService.getRawSSID();

            // READ PERSISTENT STATE TO FIX CLOSURE STALENESS
            let isPaused = await StorageService.getManualPause();

            // Auto-Reset Manual Stop if disconnected
            if (!isWifi && isPaused) {
                await StorageService.setManualPause(false);
                isPaused = false;
            }

            // Sync local state for UI (so button looks right)
            setIsManualStop(isPaused);

            const session = await StorageService.getCurrentSession();

            // ZOMBIE CHECK (Keep this)
            if (session) {
                const timeSinceHeartbeat = Date.now() - session.lastActive;
                if (timeSinceHeartbeat > 20 * 60 * 1000) {
                    console.log("Found stale session, cleaning up...");
                    await StorageService.endSession();
                    setSessionDuration(0);
                    setIsConnectedToOffice(false);
                    setCurrentSSIDName("Not Connected");
                    refreshTotals();
                    return;
                }
            }

            // SSID-SPECIFIC MATCHING
            let isOnTargetNetwork = false;
            if (isWifi && storedSSID) {
                // Use SSID matching
                isOnTargetNetwork = await NetworkService.isConnectedToTargetNetwork(storedSSID);

                if (!isOnTargetNetwork) {
                    // Connected to Wi-Fi but wrong network
                    const currentSSID = await NetworkService.getCurrentSSID();
                    if (currentSSID) {
                        newSSIDName = `Non-Office Network (${currentSSID})`;
                    } else {
                        newSSIDName = "Non-Office Network";
                    }
                }
            } else if (isWifi && !storedSSID) {
                // No SSID stored (legacy or iOS), use generic Wi-Fi detection
                isOnTargetNetwork = true;
            }

            // Logic: If OnTargetNetwork + TargetSet + NotPaused -> TRACKING
            const shouldBeTracking = isOnTargetNetwork && storedTarget && !isPaused;

            if (session && !shouldBeTracking) {
                // Must Stop
                await StorageService.endSession();
                setSessionDuration(0);
                setIsConnectedToOffice(false);
                setCurrentSSIDName(isWifi ? (isOnTargetNetwork ? "Wi-Fi Connected (Idle)" : newSSIDName) : "Not Connected");
                refreshTotals();
                return;
            }

            if (shouldBeTracking && !session) {
                // Must Start
                newSSIDName = storedTarget; // Display Friendly Name
                const newSession = await StorageService.startSession();
                newIsConnected = true;
                // Show start time immediately
                if (newSession) {
                    setCurrentSessionStart(newSession.start);
                }
            } else if (session) {
                // Check for midnight transition
                const startDay = moment(session.start).format('YYYY-MM-DD');
                const currentDay = moment().format('YYYY-MM-DD');
                if (startDay !== currentDay) {
                    console.log("Midnight transition detected! Restarting session...");
                    await StorageService.endSession();
                    await StorageService.startSession();
                    return;
                }

                // Keep Tracking
                newIsConnected = true;
                newSSIDName = storedTarget;
                // Always expose start time of active session
                setCurrentSessionStart(session.start);

                setSessionDuration(Date.now() - session.start);

                if (Date.now() - session.lastActive > 5000) {
                    await StorageService.updateSessionHeartbeat();
                }
            } else {
                setSessionDuration(0);
                setCurrentSessionStart(null);
            }

            if (!storedTarget) {
                newSSIDName = isWifi ? "Wi-Fi Connected (Not Configured)" : "Not Connected";
            } else if (isWifi && isPaused) {
                newSSIDName = "Paused (Manual)";
            }

            // Commit final state
            setIsConnectedToOffice(newIsConnected);
            setCurrentSSIDName(newSSIDName);
            setTargetSSID(storedTarget);
            setIsOnTargetNetwork(isOnTargetNetwork);

        } catch (e) {
            console.error(e);
        }
    };

    const refreshTotals = async () => {
        const newTotal = await StorageService.getTodayDuration();
        setTodayTotal(newTotal);
        const newHistory = await StorageService.getHistory();
        setHistory(newHistory);
        const sessions = await StorageService.getTodaySessions();
        setTodaySessions(sessions);

        // Calculate weekly data (weekdays only)
        const weekly = [];
        const today = moment();
        for (let i = 6; i >= 0; i--) {
            const date = today.clone().subtract(i, 'days');
            const dayOfWeek = date.day();
            // Skip Saturday (6) and Sunday (0)
            if (dayOfWeek !== 0 && dayOfWeek !== 6) {
                const dateKey = date.format('YYYY-MM-DD');
                const duration = newHistory[dateKey] || 0;
                weekly.push({
                    day: date.format('ddd'),
                    date: dateKey,
                    duration: duration,
                    hours: (duration / 1000 / 60 / 60).toFixed(1)
                });
            }
        }
        setWeeklyData(weekly);
    };


    // Handle calendar date selection
    const handleDateSelect = async (dateString) => {
        const todayStr = moment().format('YYYY-MM-DD');
        // Block future dates
        if (moment(dateString).isAfter(moment(), 'day')) return;
        if (dateString === todayStr || dateString === selectedDate) {
            // Tapping today or same date again => return to live view
            setSelectedDate(null);
            setSelectedDateTotal(0);
            setSelectedDateSessions([]);
            setSelectedWeekData([]);
            return;
        }

        setSelectedDate(dateString);

        // Fetch that day's data
        const dayTotal = await StorageService.getDurationForDate(dateString);
        setSelectedDateTotal(dayTotal);
        const daySessions = await StorageService.getSessionsForDate(dateString);
        setSelectedDateSessions(daySessions);

        // Compute that week's histogram (Mon-Fri containing the selected date)
        const selected = moment(dateString);
        const weekStart = selected.clone().startOf('isoWeek'); // Monday
        const weekEnd = selected.clone().endOf('isoWeek'); // Sunday
        const newHistory = await StorageService.getHistory();
        const weekData = [];
        for (let d = weekStart.clone(); d.isSameOrBefore(weekEnd); d.add(1, 'days')) {
            const dayOfWeek = d.day();
            if (dayOfWeek !== 0 && dayOfWeek !== 6) {
                const dk = d.format('YYYY-MM-DD');
                const duration = newHistory[dk] || 0;
                weekData.push({
                    day: d.format('ddd'),
                    date: dk,
                    duration: duration,
                    hours: (duration / 1000 / 60 / 60).toFixed(1)
                });
            }
        }
        setSelectedWeekData(weekData);
    };



    const tick = async () => {
        await checkNetworkAndSession();
    };

    // Generic open modal function
    const handleOpenModal = async (isInitialSetup) => {
        setWifiNameInput("");
        setModalTitle(isInitialSetup ? "Set Name for Office Wi-Fi" : "Rename Wi-Fi Name");
        // Pre-populate goal hours with stored value
        const storedGoal = await StorageService.getGoalHours();
        setGoalHoursInput(String(storedGoal));
        setModalVisible(true);
    };

    const handleInitialSetup = async () => {
        const isWifi = await NetworkService.isConnectedToWifi();
        if (!isWifi) {
            Alert.alert("Not Connected", "Please connect to your Office Wi-Fi first, then tap settings.");
            return;
        }

        // Capture current SSID
        const currentSSID = await NetworkService.getCurrentSSID();
        setCapturedSSID(currentSSID);

        // Open modal
        handleOpenModal(true);
    };

    const handleRenameSetup = () => {
        handleOpenModal(false); // Rename Context
    };

    const handleResetWiFi = () => {
        Alert.alert(
            "Reset Wi-Fi Configuration",
            "This will clear your current office Wi-Fi settings and all tracking history. You'll need to set it up again. Continue?",
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Reset",
                    style: "destructive",
                    onPress: async () => {
                        // Clear all Wi-Fi related storage
                        await StorageService.clearTargetSSID();
                        // End any active session
                        await StorageService.endSession();
                        // Clear all tracking history
                        await StorageService.clearHistory();
                        // Reset UI state
                        setTargetSSID(null);
                        setCurrentSSIDName("Not Connected");
                        setIsConnectedToOffice(false);
                        setSessionDuration(0);
                        setTodayTotal(0);
                        // Refresh display
                        await checkNetworkAndSession();
                        await refreshTotals();
                    }
                }
            ]
        );
    };

    const handleSaveWifiName = async () => {
        if (!wifiNameInput.trim()) {
            Alert.alert("Invalid Name", "Please enter a name for your office network (e.g. 'Work', 'HQ').");
            return;
        }

        // Parse and validate goal hours
        const parsedGoal = parseFloat(goalHoursInput);
        if (isNaN(parsedGoal) || parsedGoal <= 0 || parsedGoal > 24) {
            Alert.alert("Invalid Goal Time", "Please enter a valid goal time between 0.5 and 24 hours.");
            return;
        }

        // Save friendly name and captured SSID
        await StorageService.setTargetSSID(wifiNameInput.trim(), capturedSSID);

        // Save goal hours globally
        await StorageService.setGoalHours(parsedGoal);
        setGoalHoursState(parsedGoal);

        setTargetSSID(wifiNameInput.trim());
        setModalVisible(false);

        if (capturedSSID) {
            showSuccess(
                "All Set!",
                `Office Wi-Fi set to "${wifiNameInput.trim()}"\n\nSSID: ${capturedSSID}\nGoal: ${parsedGoal}h/day\n\nTracking will now automatically start when you connect to this network.`
            );
        } else {
            showSuccess(
                "All Set!",
                `Office Wi-Fi set to "${wifiNameInput.trim()}"\nGoal: ${parsedGoal}h/day\n\nNote: SSID detection not available. Will track on any Wi-Fi network.`
            );
        }

        await checkNetworkAndSession();
    };

    const openWifiSettings = () => {
        if (Platform.OS === 'android') {
            Linking.sendIntent("android.settings.WIFI_SETTINGS");
        } else {
            Linking.openURL("App-Prefs:root=WIFI");
        }
    };

    // Export and Battery functions kept in code but removed from UI as requested
    const openBatterySettings = () => {
        if (Platform.OS === 'android') {
            Linking.sendIntent("android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS");
        } else {
            Alert.alert("Info", "On iOS, please ensure Background App Refresh is enabled in Settings.");
        }
    };

    const exportHistoryCSV = async () => {
        try {
            const hist = await StorageService.getHistory();
            let csv = 'Date,WaitTime(Minutes),WaitTime(Hours)\n';
            Object.keys(hist).sort().forEach(date => {
                const ms = hist[date];
                const mins = (ms / 60000).toFixed(2);
                const hours = (ms / 3600000).toFixed(2);
                csv += `${date},${mins},${hours}\n`;
            });

            const path = FileSystem.documentDirectory + 'intime_export.csv';
            await FileSystem.writeAsStringAsync(path, csv, { encoding: FileSystem.EncodingType.UTF8 });

            if (await Sharing.isAvailableAsync()) {
                await Sharing.shareAsync(path);
            } else {
                Alert.alert("Error", "Sharing is not available on this device");
            }
        } catch (e) {
            Alert.alert("Export Failed", e.message);
        }
    };

    // Calculate totals
    const isViewingHistory = selectedDate !== null;
    const displayMs = isViewingHistory ? selectedDateTotal : (sessionDuration + todayTotal);
    const totalMs = sessionDuration + todayTotal; // Keep live total for ring max
    const totalHours = displayMs / (1000 * 60 * 60);
    const goalMs = goalHours * 60 * 60 * 1000; // Dynamic goal in ms
    const isGoalReached = totalHours >= goalHours;
    const displayWeekData = isViewingHistory ? selectedWeekData : weeklyData;
    const displaySessions = isViewingHistory ? selectedDateSessions : todaySessions;

    const renderCalendarDay = ({ date, state }) => {
        const dateStr = date.dateString;
        const ms = history[dateStr] || 0;
        const dur = moment.duration(ms);
        const h = Math.floor(dur.asHours());
        const m = dur.minutes();
        const hasData = ms > 0;
        const displayTime = hasData ? `${h}h${m > 0 ? ` ${m}m` : ''}` : '';
        const isToday = dateStr === moment().format('YYYY-MM-DD');
        let textColor = colors.calendarText;
        if (state === 'disabled') textColor = colors.subText;
        if (isToday) textColor = colors.accent;

        return (
            <View style={{ alignItems: 'center', justifyContent: 'center', height: 40 }}>
                <Text style={{ color: textColor, fontSize: 16, fontWeight: isToday ? 'bold' : 'normal' }}>
                    {date.day}
                </Text>
                {hasData && (
                    <Text style={{ fontSize: 9, color: isViewingHistory ? '#FF9800' : (h >= 8 ? '#4CAF50' : '#FF9800'), fontWeight: 'bold' }}>
                        {displayTime}
                    </Text>
                )}
            </View>
        );
    };

    return (
        <View style={[styles.container, { backgroundColor: colors.bg }]}>
            <StatusBar barStyle={isDark ? "light-content" : "dark-content"} translucent backgroundColor="transparent" />

            {/* Safe Area Wrapper for iOS Notches & Android Status Bars */}
            <SafeAreaView style={{ flex: 1 }}>
                <ScrollView
                    contentContainerStyle={{
                        paddingBottom: 40,
                        // Add extra padding for Android transparent status bar if needed
                        paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight + 10 : 0
                    }}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
                >
                    <View style={[styles.header, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
                        <View>
                            <Text style={[styles.headerTitle, { color: colors.text }]}>InTime</Text>
                            <Text style={[styles.headerSubtitle, { color: colors.subText }]}>{moment().format('dddd, MMM D')}</Text>
                        </View>

                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            {/* Manual Toggle: Only if target is set AND on target network */}
                            {targetSSID && isOnTargetNetwork && (
                                <TouchableOpacity style={{ marginRight: 15 }} onPress={async () => {
                                    const newState = !isManualStop;
                                    await StorageService.setManualPause(newState);
                                    setIsManualStop(newState);
                                    await checkNetworkAndSession();
                                }}>
                                    <Ionicons
                                        name={isManualStop ? "play-circle-outline" : "stop-circle-outline"}
                                        size={30}
                                        color={isManualStop ? "#4CAF50" : "#F44336"}
                                    />
                                </TouchableOpacity>
                            )}

                            {/* Reset Icon */}
                            {targetSSID && (
                                <TouchableOpacity
                                    style={{ marginRight: 15 }}
                                    onPress={handleResetWiFi}
                                >
                                    <Ionicons name="trash-outline" size={24} color="#F44336" />
                                </TouchableOpacity>
                            )}

                            {/* Edit Icon */}
                            {targetSSID && (
                                <TouchableOpacity style={styles.settingsButton} onPress={handleRenameSetup}>
                                    <Ionicons name="create-outline" size={24} color={colors.text} />
                                </TouchableOpacity>
                            )}
                        </View>
                    </View>

                    {/* Viewing History Banner */}
                    {isViewingHistory && (
                        <View style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: isDark ? 'rgba(255, 152, 0, 0.15)' : 'rgba(255, 152, 0, 0.1)',
                            paddingVertical: 8,
                            paddingHorizontal: 16,
                            marginHorizontal: 20,
                            marginBottom: 10,
                            borderRadius: 10,
                            borderWidth: 1,
                            borderColor: 'rgba(255, 152, 0, 0.3)'
                        }}>
                            <Ionicons name="calendar-outline" size={16} color="#FF9800" />
                            <Text style={{ color: '#FF9800', fontSize: 13, fontWeight: '600', marginLeft: 6, flex: 1 }}>
                                Viewing: {moment(selectedDate).format('ddd, MMM D, YYYY')}
                            </Text>
                            <TouchableOpacity onPress={() => {
                                setSelectedDate(null);
                                setSelectedDateTotal(0);
                                setSelectedDateSessions([]);
                                setSelectedWeekData([]);
                            }}>
                                <Ionicons name="close-circle" size={20} color="#FF9800" />
                            </TouchableOpacity>
                        </View>
                    )}

                    {/* Circular Progress Section */}
                    <View style={styles.progressContainer}>
                        <View style={{ position: 'relative', alignItems: 'center', justifyContent: 'center' }}>
                            <CircularProgress
                                value={Math.min(displayMs, goalMs)}
                                maxValue={goalMs} // Dynamic goal in ms
                                radius={RING_RADIUS} // Custom Radius based on Screen Width
                                duration={500} // Smoother animation
                                progressValueColor={'transparent'}
                                showProgressValue={false}
                                activeStrokeColor={isViewingHistory ? '#2196F3' : '#4CAF50'} // Blue for History, Green for Goal
                                inActiveStrokeColor={isDark ? '#333' : '#E0E0E0'}
                                title={''}
                                titleColor={'transparent'}
                                titleStyle={{ opacity: 0 }}
                                titleFontSize={RING_RADIUS * 0.3}
                            />

                            {/* Overtime Ring - Layered on top */}
                            {!isViewingHistory && displayMs > goalMs && (
                                <View style={[StyleSheet.absoluteFillObject, { alignItems: 'center', justifyContent: 'center' }]}>
                                    <CircularProgress
                                        value={displayMs - goalMs}
                                        maxValue={goalMs} // Wrap around relative to goal? Or just fill?
                                        radius={RING_RADIUS}
                                        duration={0} // Instant update for overlay
                                        progressValueColor={'transparent'}
                                        showProgressValue={false}
                                        activeStrokeColor={'#FF5252'} // Red for Overtime
                                        inActiveStrokeColor={'transparent'}
                                        title={''}
                                        titleColor={'transparent'}
                                        titleStyle={{ opacity: 0 }}
                                    />
                                </View>
                            )}
                            {/* Custom Overlay for Stable Text */}
                            <View style={{
                                position: 'absolute',
                                top: 0, left: 0, right: 0, bottom: 0,
                                justifyContent: 'center', alignItems: 'center'
                            }}>
                                <Text style={{
                                    fontSize: RING_RADIUS * 0.12,  // Responsive Font Size
                                    fontWeight: 'bold',
                                    color: colors.subText,
                                    marginBottom: 4,
                                    letterSpacing: 1
                                }}>
                                    {isViewingHistory ? moment(selectedDate).format('ddd, MMM D') : 'WORKED'}
                                </Text>
                                <Text style={{
                                    fontSize: RING_RADIUS * 0.28, // Responsive Font Size
                                    fontWeight: 'bold',
                                    color: colors.text,
                                    fontVariant: ['tabular-nums']
                                }}>
                                    {(() => {
                                        const dur = moment.duration(displayMs);
                                        const h = Math.floor(dur.asHours());
                                        const m = dur.minutes();
                                        if (isViewingHistory) return `${h}h ${m}m`;
                                        const s = dur.seconds();
                                        return `${h}h ${m}m ${s}s`;
                                    })()}
                                </Text>

                                {/* Start and End Times - show immediately when session is active */}
                                {(displaySessions.length > 0 || currentSessionStart) && (
                                    <View style={{
                                        flexDirection: 'row',
                                        justifyContent: 'space-between',
                                        width: RING_RADIUS * 1.4,
                                        marginTop: RING_RADIUS * 0.12,
                                        paddingHorizontal: RING_RADIUS * 0.1
                                    }}>
                                        {/* Start Time - First Session or current active session */}
                                        <View style={{ alignItems: 'center' }}>
                                            <Text style={{
                                                fontSize: RING_RADIUS * 0.08,
                                                fontWeight: '600',
                                                color: colors.subText,
                                                letterSpacing: 0.5
                                            }}>
                                                START
                                            </Text>
                                            <Text style={{
                                                fontSize: RING_RADIUS * 0.12,
                                                fontWeight: 'bold',
                                                color: '#4CAF50',
                                                fontVariant: ['tabular-nums']
                                            }}>
                                                {moment(displaySessions.length > 0 ? displaySessions[0].start : currentSessionStart).format('h:mm A')}
                                            </Text>
                                        </View>

                                        {/* End Time - Last Session or Now */}
                                        <View style={{ alignItems: 'center' }}>
                                            <Text style={{
                                                fontSize: RING_RADIUS * 0.08,
                                                fontWeight: '600',
                                                color: colors.subText,
                                                letterSpacing: 0.5
                                            }}>
                                                END
                                            </Text>
                                            <Text style={{
                                                fontSize: RING_RADIUS * 0.12,
                                                fontWeight: 'bold',
                                                color: '#FF9800',
                                                fontVariant: ['tabular-nums']
                                            }}>
                                                {displaySessions.length > 0
                                                    ? moment(displaySessions[displaySessions.length - 1].end || Date.now()).format('h:mm A')
                                                    : moment().format('h:mm A')}
                                            </Text>
                                        </View>
                                    </View>
                                )}
                            </View>
                        </View>

                        {isGoalReached && !isViewingHistory && (
                            <View style={styles.goalBadge}>
                                <Text style={styles.goalText}>GOAL REACHED! 🎉</Text>
                            </View>
                        )}
                    </View>

                    {/* Connection Info */}
                    <View style={[styles.card, { backgroundColor: colors.card }]}>
                        <View style={styles.row}>
                            <View style={{ flex: 1, marginRight: 10 }}>
                                <Text style={[styles.label, { color: colors.subText }]}>CURRENT NETWORK</Text>
                                <Text
                                    style={[styles.value, { color: colors.text }]}
                                    numberOfLines={1}
                                    adjustsFontSizeToFit
                                >
                                    {currentSSIDName || "Not Configured"}
                                </Text>
                            </View>
                            <View style={styles.statusDotContainer}>
                                <View style={[styles.statusDot, { backgroundColor: isConnectedToOffice ? '#4CAF50' : '#F44336' }]} />
                                <Text style={{ color: colors.subText, marginLeft: 6, fontSize: 12 }}>
                                    {isConnectedToOffice ? "TRACKING" : "IDLE"}
                                </Text>
                            </View>
                        </View>
                    </View>


                    {/* Configuration Button - ONLY Visible if Not Set */}
                    {!targetSSID && (
                        <TouchableOpacity
                            style={[
                                styles.configButton,
                                {
                                    backgroundColor: isDark ? 'rgba(76, 175, 80, 0.15)' : 'rgba(76, 175, 80, 0.1)',
                                    borderColor: isDark ? 'rgba(76, 175, 80, 0.5)' : 'rgba(76, 175, 80, 0.3)',
                                    // Remove elevation on Android to avoid black artifacts with transparent bg
                                    elevation: 0,
                                    shadowOpacity: 0,
                                }
                            ]}
                            onPress={handleInitialSetup}
                        >
                            <Text style={[styles.configButtonText, { color: isDark ? '#81C784' : '#2E7D32' }]}>
                                Set Current Wi-Fi as Office
                            </Text>
                        </TouchableOpacity>
                    )}

                    {/* Success Modal */}
                    <Modal
                        animationType="fade"
                        transparent={true}
                        visible={successVisible}
                        onRequestClose={handleSuccessClose}
                    >
                        <View style={styles.modalOverlay}>
                            <View style={[styles.modalContent, { backgroundColor: colors.card, borderColor: 'rgba(76, 175, 80, 0.3)', borderWidth: 1.5 }]}>
                                <View style={{ alignItems: 'center', marginBottom: 20 }}>
                                    <View style={{
                                        width: 70, height: 70, borderRadius: 35,
                                        backgroundColor: 'rgba(76, 175, 80, 0.15)',
                                        justifyContent: 'center', alignItems: 'center',
                                        marginBottom: 15,
                                        borderWidth: 1, borderColor: 'rgba(76, 175, 80, 0.2)'
                                    }}>
                                        <Ionicons name="checkmark" size={40} color="#4CAF50" />
                                    </View>
                                    <Text style={[styles.modalTitle, { color: colors.text, fontSize: 24 }]}>{successData.title}</Text>
                                </View>

                                <Text style={[styles.modalSubtitle, { color: colors.subText, textAlign: 'center', fontSize: 16, lineHeight: 24 }]}>
                                    {successData.message}
                                </Text>

                                <View style={{ alignItems: 'center', marginTop: 10 }}>
                                    <TouchableOpacity
                                        style={[styles.saveButton, { width: '100%', alignItems: 'center', shadowOpacity: 0.2 }]}
                                        onPress={handleSuccessClose}
                                    >
                                        <Text style={styles.saveButtonText}>Awesome!</Text>
                                    </TouchableOpacity>
                                </View>
                            </View>
                        </View>
                    </Modal>


                    {/* Weekly Histogram - Weekdays Only */}
                    {displayWeekData.length > 0 && (
                        <View style={[styles.sectionContainer, { backgroundColor: colors.card, marginBottom: 15, paddingVertical: 15 }]}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 15, paddingHorizontal: 20 }}>
                                <Ionicons name="bar-chart-outline" size={20} color={isViewingHistory ? '#FF9800' : colors.accent} />
                                <Text style={[styles.sectionTitle, { color: colors.text, marginLeft: 8 }]}>
                                    {isViewingHistory ? `Week of ${moment(selectedDate).startOf('isoWeek').format('MMM D')}` : 'This Week (Weekdays)'}
                                </Text>
                            </View>

                            <View style={{ paddingHorizontal: 20 }}>
                                {/* Bar Chart */}
                                <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 120, marginBottom: 10 }}>
                                    {displayWeekData.map((item, index) => {
                                        const maxHours = Math.max(...displayWeekData.map(d => parseFloat(d.hours)), 8);
                                        const height = (parseFloat(item.hours) / maxHours) * 80;
                                        const isToday = isViewingHistory ? (item.date === selectedDate) : (item.date === moment().format('YYYY-MM-DD'));

                                        return (
                                            <View key={index} style={{ flex: 1, alignItems: 'center', marginHorizontal: 2 }}>
                                                {/* Hour Label */}
                                                <Text style={{
                                                    fontSize: 10,
                                                    fontWeight: '600',
                                                    color: item.hours > 0 ? (isViewingHistory ? '#FF9800' : '#4CAF50') : colors.subText,
                                                    marginBottom: 4
                                                }}>
                                                    {item.hours > 0 ? `${item.hours}h` : '-'}
                                                </Text>

                                                {/* Bar */}
                                                <View style={{
                                                    width: '100%',
                                                    height: `${Math.max(height, 5)}%`,
                                                    backgroundColor: isToday
                                                        ? (isDark
                                                            ? (isViewingHistory ? 'rgba(255, 152, 0, 0.5)' : 'rgba(76, 175, 80, 0.5)')
                                                            : (isViewingHistory ? 'rgba(255, 152, 0, 0.4)' : 'rgba(76, 175, 80, 0.4)'))
                                                        : (isDark
                                                            ? (isViewingHistory ? 'rgba(255, 152, 0, 0.25)' : 'rgba(76, 175, 80, 0.25)')
                                                            : (isViewingHistory ? 'rgba(255, 152, 0, 0.2)' : 'rgba(76, 175, 80, 0.2)')),
                                                    borderRadius: 6,
                                                    borderWidth: isToday ? 2 : 1,
                                                    borderColor: isToday
                                                        ? (isViewingHistory ? '#FF9800' : '#4CAF50')
                                                        : (isViewingHistory ? 'rgba(255, 152, 0, 0.3)' : 'rgba(76, 175, 80, 0.3)'),
                                                    minHeight: 5,
                                                    position: 'relative',
                                                    overflow: 'hidden'
                                                }}>
                                                    {/* Glassmorphism effect */}
                                                    {item.hours > 0 && (
                                                        <View style={{
                                                            position: 'absolute',
                                                            top: 0,
                                                            left: 0,
                                                            right: 0,
                                                            height: '50%',
                                                            backgroundColor: 'rgba(255, 255, 255, 0.1)'
                                                        }} />
                                                    )}
                                                </View>

                                                {/* Day Label */}
                                                <Text style={{
                                                    fontSize: 11,
                                                    fontWeight: isToday ? '700' : '500',
                                                    color: isToday ? (isViewingHistory ? '#FF9800' : '#4CAF50') : colors.subText,
                                                    marginTop: 6
                                                }}>
                                                    {item.day}
                                                </Text>
                                            </View>
                                        );
                                    })}
                                </View>

                                {/* Stats */}
                                <View style={{
                                    flexDirection: 'row',
                                    justifyContent: 'space-around',
                                    paddingVertical: 10,
                                    paddingHorizontal: 10,
                                    backgroundColor: isDark
                                        ? (isViewingHistory ? 'rgba(255, 152, 0, 0.08)' : 'rgba(76, 175, 80, 0.08)')
                                        : (isViewingHistory ? 'rgba(255, 152, 0, 0.05)' : 'rgba(76, 175, 80, 0.05)'),
                                    borderRadius: 10,
                                    borderWidth: 1,
                                    borderColor: isViewingHistory ? 'rgba(255, 152, 0, 0.2)' : 'rgba(76, 175, 80, 0.2)'
                                }}>
                                    <View style={{ alignItems: 'center' }}>
                                        <Text style={{ fontSize: 11, color: colors.subText }}>Total</Text>
                                        <Text style={{ fontSize: 16, fontWeight: '700', color: isViewingHistory ? '#FF9800' : '#4CAF50' }}>
                                            {displayWeekData.reduce((sum, d) => sum + parseFloat(d.hours), 0).toFixed(1)}h
                                        </Text>
                                    </View>
                                    <View style={{ width: 1, backgroundColor: colors.divider }} />
                                    <View style={{ alignItems: 'center' }}>
                                        <Text style={{ fontSize: 11, color: colors.subText }}>Average</Text>
                                        <Text style={{ fontSize: 16, fontWeight: '700', color: isViewingHistory ? '#FF9800' : '#4CAF50' }}>
                                            {(() => {
                                                const activeDays = displayWeekData.filter(d => parseFloat(d.hours) > 0);
                                                const total = activeDays.reduce((sum, d) => sum + parseFloat(d.hours), 0);
                                                return activeDays.length > 0 ? (total / activeDays.length).toFixed(1) : '0.0';
                                            })()}h
                                        </Text>
                                    </View>
                                </View>
                            </View>
                        </View>
                    )}

                    {/* Sessions Timeline */}
                    {displaySessions.length > 0 && (
                        <View style={[styles.sectionContainer, { backgroundColor: colors.card, marginBottom: 15, paddingVertical: 20 }]}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, paddingHorizontal: 20 }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                    <Ionicons name="time-outline" size={22} color={isViewingHistory ? '#FF9800' : colors.accent} />
                                    <Text style={[styles.sectionTitle, { color: colors.text, marginLeft: 8 }]}>
                                        {isViewingHistory ? `Sessions — ${moment(selectedDate).format('MMM D')}` : "Today's Sessions"}
                                    </Text>
                                </View>
                                <Text style={{ fontSize: 12, color: colors.subText, fontWeight: '600' }}>
                                    {displaySessions.filter(s => s.duration >= 60000).length} {displaySessions.filter(s => s.duration >= 60000).length === 1 ? 'session' : 'sessions'}
                                </Text>
                            </View>



                            <ScrollView
                                style={{ maxHeight: 220 }}
                                showsVerticalScrollIndicator={false}
                                nestedScrollEnabled={true}
                            >
                                {(() => {
                                    // Filter valid sessions and sort chronologically
                                    const visibleSessions = displaySessions
                                        .filter(session => session.duration >= 60000)
                                        .sort((a, b) => a.start - b.start);

                                    return visibleSessions.map((session, index) => {
                                        const durationSec = Math.floor(session.duration / 1000);
                                        const hours = Math.floor(durationSec / 3600);
                                        const mins = Math.floor((durationSec % 3600) / 60);

                                        // Format duration without seconds
                                        let durationText = '';
                                        if (hours > 0) {
                                            durationText = `${hours}h ${mins}m`;
                                        } else {
                                            durationText = `${mins} min`;
                                        }

                                        // Check if this is an ongoing session (no end time or end time is in future)
                                        const isOngoing = !session.end || session.end > Date.now();

                                        const isLast = index === visibleSessions.length - 1;
                                        let breakElement = null;

                                        // Calculate break time if there is a next session
                                        if (!isLast) {
                                            const nextSession = visibleSessions[index + 1];
                                            const breakStart = session.end; // End of current session
                                            const breakEnd = nextSession.start; // Start of next session

                                            // Only show break if times are valid and break is positive
                                            if (breakStart && breakEnd && breakEnd > breakStart) {
                                                const breakDurationMs = breakEnd - breakStart;
                                                const breakMins = Math.floor(breakDurationMs / 60000);

                                                if (breakMins >= 1) {
                                                    const bHours = Math.floor(breakMins / 60);
                                                    const bMins = breakMins % 60;
                                                    const breakText = bHours > 0 ? `${bHours}h ${bMins}m` : `${bMins}m`;

                                                    breakElement = (
                                                        <View style={{
                                                            flexDirection: 'row',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            marginVertical: 8,
                                                            opacity: 0.7
                                                        }}>
                                                            <View style={{ height: 1, backgroundColor: colors.subText, flex: 1, marginRight: 10, opacity: 0.3 }} />
                                                            <Ionicons name="cafe-outline" size={14} color={colors.subText} />
                                                            <Text style={{ fontSize: 12, color: colors.subText, marginLeft: 6, fontWeight: '600' }}>
                                                                Break: {breakText}
                                                            </Text>
                                                            <View style={{ height: 1, backgroundColor: colors.subText, flex: 1, marginLeft: 10, opacity: 0.3 }} />
                                                        </View>
                                                    );
                                                }
                                            }
                                        }

                                        return (
                                            <React.Fragment key={index}>
                                                <View
                                                    style={{
                                                        marginHorizontal: 20,
                                                        marginBottom: breakElement ? 0 : 8, // Reduce margin if break follows
                                                        padding: 10,
                                                        borderRadius: 10,
                                                        backgroundColor: isDark
                                                            ? (isViewingHistory ? 'rgba(255, 152, 0, 0.08)' : 'rgba(76, 175, 80, 0.08)')
                                                            : (isViewingHistory ? 'rgba(255, 152, 0, 0.05)' : 'rgba(76, 175, 80, 0.05)'),
                                                        borderLeftWidth: 4,
                                                        borderLeftColor: isViewingHistory ? '#FF9800' : (isOngoing ? '#FF9800' : '#4CAF50'),
                                                        flexDirection: 'row',
                                                        alignItems: 'center',
                                                        justifyContent: 'space-between'
                                                    }}
                                                >
                                                    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
                                                        <View style={{
                                                            width: 8,
                                                            height: 8,
                                                            borderRadius: 4,
                                                            backgroundColor: isViewingHistory ? '#FF9800' : (isOngoing ? '#FF9800' : '#4CAF50'),
                                                            marginRight: 8
                                                        }} />
                                                        <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text }}>
                                                            {moment(session.start).format('h:mm A')}
                                                        </Text>
                                                        <Text style={{ marginHorizontal: 6, color: colors.subText, fontSize: 13 }}>—</Text>
                                                        <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text }}>
                                                            {isOngoing ? 'Now' : moment(session.end).format('h:mm A')}
                                                        </Text>
                                                    </View>

                                                    <View style={{
                                                        backgroundColor: isDark
                                                            ? (isViewingHistory ? 'rgba(255, 152, 0, 0.15)' : 'rgba(76, 175, 80, 0.15)')
                                                            : (isViewingHistory ? 'rgba(255, 152, 0, 0.12)' : 'rgba(76, 175, 80, 0.12)'),
                                                        paddingHorizontal: 10,
                                                        paddingVertical: 5,
                                                        borderRadius: 6,
                                                        borderWidth: 1,
                                                        borderColor: isViewingHistory ? 'rgba(255, 152, 0, 0.25)' : 'rgba(76, 175, 80, 0.25)',
                                                        minWidth: 60,
                                                        alignItems: 'center'
                                                    }}>
                                                        <Text style={{ fontSize: 12, fontWeight: '700', color: isViewingHistory ? '#FF9800' : '#4CAF50' }}>
                                                            {durationText}
                                                        </Text>
                                                    </View>
                                                </View>
                                                {breakElement}
                                            </React.Fragment>
                                        );
                                    });
                                })()}
                            </ScrollView>

                            {/* Total Break Footer */}
                            {(() => {
                                const visibleSessions = displaySessions
                                    .filter(session => session.duration >= 60000)
                                    .sort((a, b) => a.start - b.start);

                                let totalBreakMs = 0;
                                for (let i = 0; i < visibleSessions.length - 1; i++) {
                                    const end = visibleSessions[i].end;
                                    const start = visibleSessions[i + 1].start;
                                    if (end && start && start > end) {
                                        totalBreakMs += (start - end);
                                    }
                                }

                                if (totalBreakMs >= 60000) {
                                    const breakMins = Math.floor(totalBreakMs / 60000);
                                    const bHours = Math.floor(breakMins / 60);
                                    const bMins = breakMins % 60;
                                    const totalBreakText = bHours > 0 ? `${bHours}h ${bMins}m` : `${bMins}m`;

                                    return (
                                        <View style={{
                                            marginTop: 10,
                                            paddingTop: 10,
                                            borderTopWidth: 1,
                                            borderTopColor: colors.divider,
                                            flexDirection: 'row',
                                            justifyContent: 'flex-end',
                                            paddingHorizontal: 20
                                        }}>
                                            <Text style={{ fontSize: 12, color: colors.subText, marginRight: 6 }}>Total Break:</Text>
                                            <Text style={{ fontSize: 12, fontWeight: '700', color: colors.text }}>{totalBreakText}</Text>
                                        </View>
                                    );
                                }
                                return null;
                            })()}

                        </View>
                    )}

                    {/* Calendar Section */}
                    <View style={[styles.sectionContainer, { backgroundColor: colors.card, paddingVertical: 10 }]}>
                        <Text style={[styles.sectionTitle, { color: colors.text, marginLeft: 15, marginTop: 15 }]}>History</Text>
                        <Calendar
                            key={`${isDark ? 'dark' : 'light'}-${isViewingHistory ? 'history' : 'live'}`}
                            theme={{
                                backgroundColor: colors.card,
                                calendarBackground: colors.card,
                                textSectionTitleColor: colors.subText,
                                selectedDayBackgroundColor: isViewingHistory ? '#FF9800' : colors.accent,
                                selectedDayTextColor: '#ffffff',
                                todayTextColor: colors.accent,
                                dayTextColor: colors.text,
                                textDisabledColor: '#d9e1e8',
                                arrowColor: isViewingHistory ? '#FF9800' : colors.accent,
                                monthTextColor: colors.text,
                                indicatorColor: isViewingHistory ? '#FF9800' : colors.accent,
                            }}
                            dayComponent={(props) => (
                                <TouchableOpacity onPress={() => handleDateSelect(props.date.dateString)}>
                                    {renderCalendarDay(props)}
                                </TouchableOpacity>
                            )}
                            enableSwipeMonths={false}
                            markedDates={selectedDate ? { [selectedDate]: { selected: true, selectedColor: '#FF9800' } } : {}}
                        />
                    </View>

                </ScrollView>
            </SafeAreaView>

            {/* Wi-Fi Naming Modal - Simplified */}
            <Modal
                transparent={true}
                visible={modalVisible}
                animationType="fade"
                onRequestClose={() => setModalVisible(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
                        {/* Dynamic Title */}
                        <Text style={[styles.modalTitle, { color: colors.text }]}>{modalTitle}</Text>

                        {/* Show captured SSID if available */}
                        {capturedSSID && (
                            <View style={{ backgroundColor: colors.inputBg, padding: 12, borderRadius: 8, marginBottom: 15 }}>
                                <Text style={{ color: colors.subText, fontSize: 12, marginBottom: 4 }}>Detected Network:</Text>
                                <Text style={{ color: colors.text, fontSize: 16, fontWeight: 'bold' }}>{capturedSSID}</Text>
                                <Text style={{ color: colors.subText, fontSize: 11, marginTop: 4 }}>
                                    ✓ Tracking will only work on this specific Wi-Fi
                                </Text>
                            </View>
                        )}

                        {/* Show iOS warning if SSID not available */}
                        {!capturedSSID && modalTitle.includes('Set Name') && (
                            <View style={{ backgroundColor: '#FFF3CD', padding: 12, borderRadius: 8, marginBottom: 15 }}>
                                <Text style={{ color: '#856404', fontSize: 12 }}>
                                    ⚠️ SSID detection not available. Will track on any Wi-Fi network.
                                </Text>
                            </View>
                        )}

                        <TextInput
                            style={[styles.input, { backgroundColor: colors.inputBg, color: colors.text }]}
                            placeholder="e.g. Work Wi-Fi"
                            placeholderTextColor={colors.subText}
                            value={wifiNameInput}
                            onChangeText={setWifiNameInput}
                            autoFocus={true}
                        />

                        {/* Goal Time Input */}
                        <Text style={{ color: colors.subText, fontSize: 12, marginBottom: 6, marginTop: 4 }}>Daily Goal (hours)</Text>
                        <TextInput
                            style={[styles.input, { backgroundColor: colors.inputBg, color: colors.text }]}
                            placeholder="8.5"
                            placeholderTextColor={colors.subText}
                            value={goalHoursInput}
                            onChangeText={setGoalHoursInput}
                            keyboardType="decimal-pad"
                        />

                        <View style={styles.modalButtons}>
                            <TouchableOpacity style={styles.cancelButton} onPress={() => setModalVisible(false)}>
                                <Text style={styles.cancelButtonText}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.saveButton} onPress={handleSaveWifiName}>
                                <Text style={styles.saveButtonText}>Save</Text>
                            </TouchableOpacity>
                        </View>

                        {/* Troubleshooting & Backup Section REMOVED */}

                    </View>
                </View>
            </Modal>
        </View>
    );
}

// Styles imported from src/styles/AppStyles.js

