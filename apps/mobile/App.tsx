import React, { useEffect, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  StatusBar,
  Alert,
} from "react-native";

// =========================
// CONFIG
// =========================

// OJO: si pruebas en el EMULADOR WEB, puedes usar http://localhost:3000
// Si pruebas en el MÓVIL FÍSICO, pon la IP local de tu PC, por ej.
// const BASE_URL = "http://192.168.1.34:3000";
//const BASE_URL = "http://localhost:3000";
const BASE_URL = "http://192.168.0.214:3000";


// De momento usamos tu userId fijo
const USER_ID = "cmibx9guz0000r0pgfnmwaflp";

// Colores MOOVIA
const COLORS = {
  primary: "#501FF0",
  accent: "#1DF09F",
  danger: "#F0411D",
  warning: "#F0DC1D",
  brown: "#9B5546",
  darkCard: "#504670",
  blueCard: "#227DA3",
  bg: "#F2F2F2",
  text: "#0F172A",
  textMuted: "#6B7280",
};

type WorkoutSession = {
  id: string;
  exercise: string;
  date: string;
};

type UserResponse = {
  id: string;
  email: string;
  sessions?: WorkoutSession[];
};

export default function App() {
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // =========================
  // Cargar sesiones del usuario
  // =========================
  const fetchSessions = async () => {
    try {
      setLoading(true);
      setError(null);

      const res = await fetch(`${BASE_URL}/users/${USER_ID}`);
      if (!res.ok) {
        throw new Error(`Error ${res.status}`);
      }

      const data: UserResponse = await res.json();
      const userSessions = data.sessions ?? [];

      // Ordenar por fecha descendente (las últimas arriba)
      const sorted = [...userSessions].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );

      setSessions(sorted);
    } catch (e: any) {
      console.error(e);
      setError("No se pudieron cargar las sesiones.");
    } finally {
      setLoading(false);
    }
  };

  // =========================
  // Crear nueva sesión rápida
  // =========================
  const createQuickSession = async () => {
    try {
      setCreating(true);
      setError(null);

      // Por ahora creamos siempre una sesión de Snatch.
      // Luego podemos abrir un selector de ejercicio.
      const res = await fetch(`${BASE_URL}/workouts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: USER_ID,
          exercise: "Snatch",
        }),
      });

      if (!res.ok) {
        throw new Error(`Error ${res.status}`);
      }

      const session: WorkoutSession = await res.json();
      // Añadimos al principio de la lista
      setSessions((prev) => [session, ...prev]);

      Alert.alert("Sesión creada", "Se ha creado una sesión de Snatch.");
    } catch (e: any) {
      console.error(e);
      setError("No se pudo crear la sesión.");
    } finally {
      setCreating(false);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, []);

  const renderSession = ({ item }: { item: WorkoutSession }) => {
    const date = new Date(item.date);
    const formatted = date.toLocaleString();

    return (
      <View
        style={{
          backgroundColor: COLORS.blueCard,
          borderRadius: 16,
          padding: 16,
          marginBottom: 12,
        }}
      >
        <Text
          style={{
            color: "white",
            fontSize: 18,
            fontWeight: "700",
            marginBottom: 4,
          }}
        >
          {item.exercise}
        </Text>
        <Text style={{ color: "#E5E7EB", fontSize: 13 }}>{formatted}</Text>
      </View>
    );
  };

  return (
    <SafeAreaView
      style={{
        flex: 1,
        backgroundColor: COLORS.bg,
      }}
    >
      <StatusBar barStyle="light-content" />

      {/* HEADER */}
      <View
        style={{
          backgroundColor: COLORS.primary,
          paddingHorizontal: 20,
          paddingTop: 12,
          paddingBottom: 20,
          borderBottomLeftRadius: 24,
          borderBottomRightRadius: 24,
        }}
      >
        <Text
          style={{
            color: "white",
            fontSize: 24,
            fontWeight: "800",
            marginBottom: 4,
          }}
        >
          MOOVIA
        </Text>
        <Text
          style={{
            color: "#E5E7EB",
            fontSize: 14,
          }}
        >
          Tus sesiones de halterofilia
        </Text>

        {/* "Chip" de estado */}
        <View
          style={{
            marginTop: 12,
            alignSelf: "flex-start",
            paddingHorizontal: 10,
            paddingVertical: 4,
            borderRadius: 999,
            backgroundColor: COLORS.accent,
          }}
        >
          <Text
            style={{
              color: "#064E3B",
              fontSize: 12,
              fontWeight: "600",
            }}
          >
            Usuario demo · {USER_ID.slice(0, 6)}…
          </Text>
        </View>
      </View>

      {/* CONTENIDO */}
      <View
        style={{
          flex: 1,
          paddingHorizontal: 20,
          paddingTop: 20,
        }}
      >
        {/* Estado de carga / error */}
        {loading && (
          <View
            style={{
              alignItems: "center",
              marginTop: 40,
            }}
          >
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text
              style={{ marginTop: 8, color: COLORS.textMuted, fontSize: 14 }}
            >
              Cargando sesiones…
            </Text>
          </View>
        )}

        {error && !loading && (
          <View style={{ marginBottom: 12 }}>
            <Text style={{ color: COLORS.danger, fontSize: 14 }}>{error}</Text>
          </View>
        )}

        {!loading && sessions.length === 0 && !error && (
          <View style={{ marginTop: 40 }}>
            <Text
              style={{
                color: COLORS.textMuted,
                fontSize: 14,
                textAlign: "center",
              }}
            >
              Aún no tienes sesiones registradas.
            </Text>
            <Text
              style={{
                color: COLORS.textMuted,
                fontSize: 14,
                textAlign: "center",
                marginTop: 4,
              }}
            >
              Crea tu primera sesión con el botón de abajo.
            </Text>
          </View>
        )}

        {/* Lista de sesiones */}
        <FlatList
          data={sessions}
          keyExtractor={(item) => item.id}
          renderItem={renderSession}
          contentContainerStyle={{
            paddingBottom: 100,
            paddingTop: sessions.length ? 0 : 16,
          }}
          showsVerticalScrollIndicator={false}
        />
      </View>

      {/* BOTÓN FLOTANTE */}
      <View
        style={{
          position: "absolute",
          bottom: 24,
          right: 24,
        }}
      >
        <TouchableOpacity
          onPress={createQuickSession}
          disabled={creating}
          style={{
            backgroundColor: COLORS.accent,
            paddingHorizontal: 22,
            paddingVertical: 14,
            borderRadius: 999,
            flexDirection: "row",
            alignItems: "center",
            shadowColor: "#000",
            shadowOpacity: 0.25,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 4 },
            elevation: 6,
          }}
        >
          <Text
            style={{
              fontSize: 18,
              fontWeight: "800",
              marginRight: 6,
              color: "#064E3B",
            }}
          >
            +
          </Text>
          <Text
            style={{
              color: "#064E3B",
              fontWeight: "700",
            }}
          >
            Nueva sesión
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

