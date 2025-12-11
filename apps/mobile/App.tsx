import React from "react";
import { SafeAreaView, StatusBar, StyleSheet, Text } from "react-native";
import { BLEDeviceScreen } from "./src/screens/BLEDeviceScreen";

export default function App() {
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#501FF0" />
      <BLEDeviceScreen />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0F0F1E",
  },
});
