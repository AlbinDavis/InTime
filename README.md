# InTime - Office Time Tracker with Background Daemon

A React Native (Expo) app that runs as a **persistent background daemon** to automatically track time spent connected to your office Wi-Fi network, even when the app is closed or removed from recent apps.

## 🚀 Features

- **True Background Daemon**: Continues tracking even when app is closed or removed from recent apps
- **Auto-Start on Boot**: Automatically restarts tracking after device reboot (Android)
- **Foreground Service**: Uses Android foreground service for persistent operation
- **Battery Optimization Handling**: Built-in UI to help users exempt the app from battery restrictions
- **Session History**: View daily breakdown of time spent in the office
- **Manual Controls**: Pause/resume tracking manually
- **Dark Mode Support**: Automatic light/dark theme switching

## 📋 Prerequisites

- Node.js (v16 or higher)
- Android device (for full daemon functionality) or iOS device
- Physical device recommended (background services work best on real hardware)

## 🛠️ Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Build and Run

#### For Android (Recommended for daemon features)
```bash
npx expo run:android
```

#### For iOS
```bash
npx expo run:ios
```

> **Note**: iOS has strict background execution limits. While the app will use background location and fetch, true daemon behavior is only available on Android.

## ⚙️ Initial Configuration

### First Time Setup

1. **Launch the app** on your device
2. **Connect to your office Wi-Fi**
3. **Tap "Set Current Wi-Fi as Office"** to configure tracking
4. **Grant permissions** when prompted:
   - Location: Select **"Allow all the time"** (critical for background tracking)
   - Notifications: Allow (for foreground service notification)

### Android-Specific Setup (Critical for Daemon Behavior)

#### 1. Disable Battery Optimization
- Tap the **"⚡ Disable Battery Optimization"** button in the app
- Find "InTime" in the list
- Select **"Don't optimize"** or **"Unrestricted"**
- This prevents Android from killing the background service

#### 2. Manufacturer-Specific Settings

Some Android manufacturers (Xiaomi, Huawei, OnePlus, etc.) have aggressive battery management. You may need to:

**Xiaomi/MIUI:**
- Go to Settings → Apps → Manage apps → InTime
- Enable **"Autostart"**
- Set Battery saver to **"No restrictions"**

**Huawei/EMUI:**
- Go to Settings → Apps → InTime
- Enable **"Autostart"**
- Under Battery → App launch, set to **"Manage manually"** and enable all options

**OnePlus/OxygenOS:**
- Go to Settings → Apps → InTime → Battery
- Set Battery optimization to **"Don't optimize"**
- Enable **"Allow background activity"**

**Samsung/One UI:**
- Go to Settings → Apps → InTime → Battery
- Set to **"Unrestricted"**
- Disable **"Put app to sleep"**

## 🔍 How It Works

### Background Tracking Mechanism

1. **Foreground Service**: The app starts a persistent foreground service that displays a notification
2. **Location Updates**: Uses background location updates as a trigger (every 60 seconds)
3. **Wi-Fi Monitoring**: Checks Wi-Fi connection status when triggered
4. **Session Management**: Automatically starts/stops tracking sessions based on Wi-Fi connectivity
5. **Boot Receiver**: Automatically restarts the service when device boots

### Architecture

```
┌─────────────────────────────────────────┐
│          React Native App (UI)          │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│      ForegroundService Manager          │
│  (Manages persistent background task)   │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│    expo-location Background Task        │
│   (Triggers every 60s via location)     │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│      Wi-Fi Connection Check             │
│   (Network state + Storage service)     │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│      Session Start/Stop/Update          │
│     (Persistent storage tracking)       │
└─────────────────────────────────────────┘
```

## 📱 Usage

### Normal Operation

1. **Connect to office Wi-Fi**: Tracking starts automatically
2. **Disconnect or leave office**: Tracking stops automatically
3. **Close the app**: Service continues running in background
4. **Remove from recent apps**: Service persists
5. **Reboot device**: Service automatically restarts (Android)

### Manual Controls

- **Pause/Resume**: Tap the play/stop icon in the header (only visible when Wi-Fi is configured)
- **Rename Wi-Fi**: Tap the edit icon to change the display name
- **View History**: Scroll down to see the calendar with daily tracking

### Indicators

- **Green dot + "TRACKING"**: Currently tracking time
- **Red dot + "IDLE"**: Not currently tracking
- **Persistent notification** (Android): Shows "InTime - Tracking Active" when service is running

## 🧪 Testing Daemon Behavior

### Test 1: App Closed
1. Start tracking (connect to Wi-Fi)
2. Close the app completely
3. Wait 5 minutes
4. Reopen app → Time should have continued tracking

### Test 2: Removed from Recent Apps
1. Start tracking
2. Open recent apps menu
3. Swipe away InTime
4. Wait 5 minutes
5. Reopen app → Time should have continued tracking

### Test 3: Device Reboot (Android)
1. Start tracking
2. Reboot your device
3. After boot, check if app auto-started (look for notification)
4. Open app → Tracking should have resumed

### Test 4: Battery Optimization
1. Enable battery saver mode
2. Verify tracking continues
3. Check that notification remains visible

## 🐛 Troubleshooting

### Tracking Stops When App is Closed

**Cause**: Battery optimization is enabled
**Solution**: 
- Tap "⚡ Disable Battery Optimization" in the app
- Check manufacturer-specific settings (see setup section)

### App Doesn't Restart After Reboot

**Cause**: Autostart permission not granted (manufacturer restriction)
**Solution**:
- Enable "Autostart" in your device's app settings
- Check manufacturer-specific settings

### Notification Disappears

**Cause**: System killed the foreground service
**Solution**:
- Ensure battery optimization is disabled
- Set app to "Unrestricted" battery usage
- Enable "Allow background activity"

### Location Permission Issues

**Cause**: Permission not set to "Allow all the time"
**Solution**:
- Go to Settings → Apps → InTime → Permissions → Location
- Select **"Allow all the time"**

## 📊 Data Export

The app stores all tracking data locally. To export:
1. Use the export function in the app (if implemented)
2. Data is stored in AsyncStorage on the device

## 🔒 Privacy

- **All data stays on your device** - no cloud sync
- **Location is only used as a trigger** - not stored or transmitted
- **Wi-Fi SSID is not stored** - only a user-defined name
- **No analytics or tracking** - completely private

## 🔋 Battery Impact

Running as a background daemon will consume more battery than a standard app. Expected impact:
- **Light usage**: ~5-10% additional battery drain per day
- **The foreground service notification** is required by Android and cannot be hidden
- **Location checks every 60 seconds** are optimized for battery efficiency

## 📝 Technical Details

### Permissions Used

**Android:**
- `ACCESS_BACKGROUND_LOCATION` - Background Wi-Fi monitoring
- `FOREGROUND_SERVICE` - Persistent service
- `RECEIVE_BOOT_COMPLETED` - Auto-start on boot
- `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` - Battery exemption
- `WAKE_LOCK` - Keep CPU awake for background tasks
- `POST_NOTIFICATIONS` - Foreground service notification

**iOS:**
- `location` (always) - Background location updates
- `fetch` - Background fetch
- `processing` - Background processing
- `remote-notification` - Background notifications

### Files Modified for Daemon Functionality

- `android/app/src/main/AndroidManifest.xml` - Permissions and boot receiver
- `app.json` - Platform configurations
- `src/services/ForegroundService.js` - Service manager
- `android/app/src/main/java/.../BootReceiver.kt` - Boot receiver
- `App.js` - Integration with foreground service

## 🤝 Contributing

This is a personal time tracking app. Feel free to fork and customize for your needs.

## 📄 License

Private use only.

## 🆘 Support

For issues or questions, check the troubleshooting section above or review the code comments in:
- `src/services/ForegroundService.js` - Service management
- `App.js` - Main application logic
- `android/.../BootReceiver.kt` - Boot receiver logic
