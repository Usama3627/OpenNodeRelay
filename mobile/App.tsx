/**
 * OpenNodeRelay Mobile App
 * Bring Your Own Compute — remote terminal over WebRTC DataChannel
 */

import React from 'react';
import {StatusBar, StyleSheet, View} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {GestureHandlerRootView} from 'react-native-gesture-handler';

import {DaemonProvider} from './src/context/DaemonContext';
import {PairScreen} from './src/screens/PairScreen';
import {TerminalScreen} from './src/screens/TerminalScreen';
import {SettingsScreen} from './src/screens/SettingsScreen';
import {COLORS, FONT_MONO} from './src/utils/theme';

const Stack = createNativeStackNavigator();

const navFonts = {
  regular: {
    fontFamily: FONT_MONO,
    fontWeight: '400' as const,
  },
  medium: {
    fontFamily: FONT_MONO,
    fontWeight: '500' as const,
  },
  bold: {
    fontFamily: FONT_MONO,
    fontWeight: '700' as const,
  },
  heavy: {
    fontFamily: FONT_MONO,
    fontWeight: '900' as const,
  },
};

function App(): React.JSX.Element {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <StatusBar
          barStyle="light-content"
          backgroundColor={COLORS.bg}
          translucent={false}
        />
        <DaemonProvider>
          <NavigationContainer
            theme={{
              dark: true,
              fonts: navFonts,
              colors: {
                primary: COLORS.green,
                background: COLORS.bg,
                card: COLORS.bgCard,
                text: COLORS.textPrimary,
                border: COLORS.bgBorder,
                notification: COLORS.red,
              },
            }}>
            <Stack.Navigator
              initialRouteName="Pair"
              screenOptions={{
                headerShown: false,
                animation: 'slide_from_right',
                contentStyle: {backgroundColor: COLORS.bg},
              }}>
              <Stack.Screen name="Pair" component={PairScreen} />
              <Stack.Screen name="Terminal" component={TerminalScreen} />
              <Stack.Screen name="Settings" component={SettingsScreen} />
            </Stack.Navigator>
          </NavigationContainer>
        </DaemonProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
});

export default App;
