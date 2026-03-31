/**
 * OpenNodeRelay Mobile App entry point
 * @format
 */

import {registerGlobals} from 'react-native-webrtc';
import {AppRegistry} from 'react-native';
import App from './App';
import {name as appName} from './app.json';

// Register WebRTC globals (RTCPeerConnection, RTCSessionDescription, etc.)
// so that any third-party code that uses them without explicit imports works.
registerGlobals();

AppRegistry.registerComponent(appName, () => App);
