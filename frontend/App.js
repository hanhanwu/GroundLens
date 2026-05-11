import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

const BACKEND_URL = 'http://127.0.0.1:8000';

export default function App() {
  const [status, setStatus] = useState('Checking backend...');

  useEffect(() => {
    fetch(`${BACKEND_URL}/health`)
      .then((res) => res.json())
      .then((data) => setStatus(`Backend: ${data.status}`))
      .catch(() => setStatus('Backend: unreachable'));
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>GroundLens</Text>
      <Text style={styles.status}>{status}</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  status: {
    fontSize: 16,
    color: '#555',
  },
});
