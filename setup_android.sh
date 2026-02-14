#!/bin/bash
export ANDROID_HOME="/opt/homebrew/share/android-commandlinetools"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"

# Install SDK packages (API 34 is standard for RN 0.73+)
# We need: platforms;android-34, build-tools;34.0.0, platform-tools
echo "y" | sdkmanager "platforms;android-34" "build-tools;34.0.0" "platform-tools" --sdk_root=$ANDROID_HOME

# Accept all licenses
yes | sdkmanager --licenses --sdk_root=$ANDROID_HOME
