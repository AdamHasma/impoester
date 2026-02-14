import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { doc, setDoc } from "firebase/firestore";
import { db } from "../firebase";

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

  const handleCreateRoom = async () => {
    if (!playerName.trim()) return alert("Bitte gib einen Namen ein!");
    setIsLoading(true);
    try {
      const newRoomCode = Math.random()
        .toString(36)
        .substring(2, 6)
        .toUpperCase();
      const roomRef = doc(db, "rooms", newRoomCode);
      await setDoc(roomRef, {
        status: "lobby",
        players: [{ name: playerName, isHost: true }],
        createdAt: new Date(),
      });
      localStorage.setItem("playerName", playerName);
      navigate(`/room/${newRoomCode}`);
    } catch (error) {
      console.error("Fehler:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleJoinRoom = () => {
    if (!playerName.trim()) return alert("Bitte gib einen Namen ein!");
    if (!roomCode.trim() || roomCode.length !== 4)
      return alert("Bitte gib einen Code ein!");
    localStorage.setItem("playerName", playerName);
    navigate(`/room/${roomCode.toUpperCase()}`);
  };

  return (
    // Elegante Einflug-Animation für die helle Karte
    <Card className="shadow-2xl border-slate-200 bg-white/90 backdrop-blur-xl animate-in fade-in zoom-in-95 duration-700">
      <CardHeader className="text-center pb-4">
        <CardTitle className="text-5xl font-black text-slate-800 tracking-tight">
          Imposter
        </CardTitle>
        <CardDescription className="text-slate-500 text-md mt-2">
          Finde den Verräter unter deinen Freunden!
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">
            Dein Spielername
          </label>
          <Input
            placeholder="z.B. Spieler123"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            maxLength={15}
            className="h-14 text-lg bg-slate-50 border-slate-200 focus-visible:ring-blue-500 transition-all"
          />
        </div>

        <div className="pt-4 border-t border-slate-100 space-y-6">
          <div className="bg-slate-50 p-5 rounded-xl border border-slate-200 shadow-sm space-y-3">
            <label className="text-sm font-semibold text-slate-700 block text-center">
              Hast du einen Einladungscode?
            </label>
            <div className="flex gap-2">
              <Input
                placeholder="CODE"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                maxLength={4}
                className="uppercase font-bold text-center tracking-widest text-xl h-14 w-full bg-white border-slate-300"
              />
              <Button
                onClick={handleJoinRoom}
                className="h-14 px-6 bg-blue-600 hover:bg-blue-700 text-white text-md font-bold transition-all hover:scale-[1.03] active:scale-95 shadow-md"
              >
                Beitreten
              </Button>
            </div>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center text-xs uppercase font-bold tracking-widest">
              <span className="bg-white px-3 text-slate-400">Oder</span>
            </div>
          </div>

          <Button
            variant="outline"
            className="w-full h-14 text-md font-semibold border-2 border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-blue-600 transition-all hover:scale-[1.02] active:scale-95"
            onClick={handleCreateRoom}
            disabled={isLoading}
          >
            {isLoading ? "Erstelle Raum..." : "Neuen Raum erstellen"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
