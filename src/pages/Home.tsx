import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { doc, setDoc } from "firebase/firestore";
import { db } from "../firebase";

// UI Komponenten von shadcn
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function Home() {
  const [playerName, setPlayerName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const navigate = useNavigate();

  // Funktion 1: Einen neuen Raum erstellen
  const handleCreateRoom = async () => {
    if (!playerName.trim()) return alert("Bitte gib einen Namen ein!");

    setIsLoading(true);
    try {
      // 1. Zufälligen 4-stelligen Code generieren (z.B. "A7K9")
      const newRoomCode = Math.random()
        .toString(36)
        .substring(2, 6)
        .toUpperCase();

      // 2. Den Raum in Firebase erstellen
      const roomRef = doc(db, "rooms", newRoomCode);
      await setDoc(roomRef, {
        status: "lobby", // Spiel hat noch nicht begonnen
        players: [{ name: playerName, isHost: true }], // Der Ersteller ist der Host
        createdAt: new Date(),
      });

      // 3. Spieler-Namen im Browser speichern (damit wir ihn im Raum noch wissen)
      localStorage.setItem("playerName", playerName);

      // 4. Zum neuen Raum navigieren
      navigate(`/room/${newRoomCode}`);
    } catch (error) {
      console.error("Fehler beim Erstellen des Raums:", error);
      alert("Es gab ein Problem beim Erstellen des Raums.");
    } finally {
      setIsLoading(false);
    }
  };

  // Funktion 2: Einem existierenden Raum beitreten
  const handleJoinRoom = () => {
    if (!playerName.trim()) return alert("Bitte gib einen Namen ein!");
    if (!roomCode.trim() || roomCode.length !== 4)
      return alert("Bitte gib einen gültigen 4-stelligen Code ein!");

    // Namen speichern und zum Raum navigieren (die Firebase-Logik fürs Beitreten machen wir im Room.tsx)
    localStorage.setItem("playerName", playerName);
    navigate(`/room/${roomCode.toUpperCase()}`);
  };

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-3xl font-bold text-slate-800">
          Imposter Game
        </CardTitle>
        <CardDescription>
          Finde den Verräter unter deinen Freunden!
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Name Eingabe */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700">
            Dein Name
          </label>
          <Input
            placeholder="z.B. Spieler123"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            maxLength={15}
          />
        </div>

        <div className="border-t border-slate-200 pt-6 space-y-4">
          {/* Raum erstellen */}
          <Button
            className="w-full"
            onClick={handleCreateRoom}
            disabled={isLoading}
          >
            {isLoading ? "Erstelle Raum..." : "Neues Spiel erstellen"}
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white px-2 text-slate-500">Oder</span>
            </div>
          </div>

          {/* Raum beitreten */}
          <div className="flex space-x-2">
            <Input
              placeholder="Raum-Code (z.B. A7K9)"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              maxLength={4}
              className="uppercase"
            />
            <Button variant="secondary" onClick={handleJoinRoom}>
              Beitreten
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
