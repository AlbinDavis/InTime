import { NativeModules } from 'react-native';

const { WidgetUpdate } = NativeModules;

class WidgetService {
    static updateWidget() {
        try {
            if (WidgetUpdate && WidgetUpdate.updateWidget) {
                WidgetUpdate.updateWidget();
            }
        } catch (error) {
            console.log('Widget update not available:', error);
        }
    }
}

export default WidgetService;
