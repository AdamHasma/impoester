import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  doc,
  getDoc,
  updateDoc,
  arrayUnion,
  arrayRemove,
  onSnapshot,
} from "firebase/firestore";
import { db } from "../firebase";
import { gameWords } from "../gameWords";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface Player {
  name: string;
  isHost: boolean;
}
interface RoomData {
  status: string;
  players: Player[];
  word?: string;
  hint?: string;
  imposter?: string;
  currentTurnIndex?: number;
  turnOrder?: string[];
  turnEndsAt?: number;
  votes?: Record<string, string>;
  votedOut?: string;
  round?: number;
}

function shuffleArray(array: string[]) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

const TURN_DURATION_MS = 30 * 1000;

export default function Room() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const playerName = localStorage.getItem("playerName") || "";

  const [roomData, setRoomData] = useState<RoomData | null>(null);
  const [error, setError] = useState("");
  const [hasJoined, setHasJoined] = useState(false);
  const [timeLeft, setTimeLeft] = useState(30);

  // --- FIX 1: navigate() darf nicht mit "return" direkt im useEffect aufgerufen werden
  useEffect(() => {
    if (!roomId || !playerName) {
      navigate("/");
      return;
    }

    const roomRef = doc(db, "rooms", roomId);

    const joinRoom = async () => {
      try {
        const snap = await getDoc(roomRef);
        if (!snap.exists()) return setError("Diesen Raum-Code gibt es nicht.");
        const data = snap.data() as RoomData;
        if (data.players.some((p) => p.name === playerName)) {
          setHasJoined(true);
        } else {
          if (data.players.length >= 5) return setError("Der Raum ist voll.");
          await updateDoc(roomRef, {
            players: arrayUnion({ name: playerName, isHost: false }),
          });
          setHasJoined(true);
        }
      } catch (err) {
        setError("Ein Fehler ist aufgetreten.");
      }
    };
    joinRoom();

    const unsubscribe = onSnapshot(roomRef, (snap) => {
      if (snap.exists()) setRoomData(snap.data() as RoomData);
      else setError("Der Raum wurde geschlossen.");
    });
    return () => unsubscribe();
  }, [roomId, playerName, navigate]);

  useEffect(() => {
    if (
      hasJoined &&
      roomData &&
      !roomData.players.some((p) => p.name === playerName)
    ) {
      alert("Du wurdest vom Host entfernt.");
      navigate("/");
    }
  }, [roomData, hasJoined, playerName, navigate]);

  const handleKickPlayer = async (player: Player) => {
    if (roomId)
      await updateDoc(doc(db, "rooms", roomId), {
        players: arrayRemove(player),
      });
  };

  const isHost = roomData?.players.find((p) => p.name === playerName)?.isHost;

  const handleStartGame = async () => {
    if (!roomId || !roomData) return;
    const selectedWord =
      gameWords[Math.floor(Math.random() * gameWords.length)];
    const imposterName =
      roomData.players[Math.floor(Math.random() * roomData.players.length)]
        .name;
    try {
      await updateDoc(doc(db, "rooms", roomId), {
        status: "playing",
        word: selectedWord.word,
        hint: selectedWord.hint,
        imposter: imposterName,
        currentTurnIndex: 0,
        round: 1,
        votes: {},
        votedOut: "",
        turnOrder: shuffleArray(roomData.players.map((p) => p.name)),
        turnEndsAt: Date.now() + TURN_DURATION_MS,
      });
    } catch (e) {}
  };

  const handleNextTurn = async () => {
    if (!roomId || !roomData || roomData.currentTurnIndex === undefined) return;
    const nextIndex = roomData.currentTurnIndex + 1;
    const roomRef = doc(db, "rooms", roomId);
    if (nextIndex >= roomData.players.length) {
      await updateDoc(roomRef, { status: "voting", votes: {} });
    } else {
      await updateDoc(roomRef, {
        currentTurnIndex: nextIndex,
        turnEndsAt: Date.now() + TURN_DURATION_MS,
      });
    }
  };

  useEffect(() => {
    if (roomData?.status !== "playing" || !roomData.turnEndsAt) return;
    const interval = setInterval(() => {
      setTimeLeft(
        Math.max(0, Math.floor((roomData.turnEndsAt! - Date.now()) / 1000)),
      );
    }, 1000);
    return () => clearInterval(interval);
  }, [roomData?.status, roomData?.turnEndsAt]);

  useEffect(() => {
    if (timeLeft === 0 && isHost && roomData?.status === "playing")
      handleNextTurn();
  }, [timeLeft, isHost, roomData?.status]);

  const handleVote = async (target: string) => {
    if (roomId)
      await updateDoc(doc(db, "rooms", roomId), {
        [`votes.${playerName}`]: target,
      });
  };

  useEffect(() => {
    if (!isHost || !roomData || roomData.status !== "voting" || !roomData.votes)
      return;
    const voteCount = Object.keys(roomData.votes).length;

    if (voteCount > 0 && voteCount === roomData.players.length) {
      const tally: Record<string, number> = {};
      Object.values(roomData.votes).forEach(
        (v) => (tally[v] = (tally[v] || 0) + 1),
      );

      let maxVotes = 0,
        candidate = "",
        isTie = false;
      for (const [name, count] of Object.entries(tally)) {
        if (count > maxVotes) {
          maxVotes = count;
          candidate = name;
          isTie = false;
        } else if (count === maxVotes) isTie = true;
      }

      const roomRef = doc(db, "rooms", roomId!);
      if (isTie || candidate === "SKIP") {
        updateDoc(roomRef, {
          status: "playing",
          currentTurnIndex: 0,
          round: (roomData.round || 1) + 1,
          votes: {},
          turnOrder: shuffleArray(roomData.players.map((p) => p.name)),
          turnEndsAt: Date.now() + TURN_DURATION_MS,
        });
      } else {
        updateDoc(roomRef, { status: "finished", votedOut: candidate });
      }
    }
  }, [roomData, isHost, roomId]);

  const handleBackToLobby = async () => {
    if (roomId)
      await updateDoc(doc(db, "rooms", roomId), {
        status: "lobby",
        currentTurnIndex: 0,
        votes: {},
        votedOut: "",
        word: "",
        hint: "",
        imposter: "",
        turnOrder: [],
      });
  };

  if (error)
    return (
      <div className="text-red-500 font-bold p-8 text-center">{error}</div>
    );
  if (!roomData)
    return (
      <div className="text-center font-semibold text-slate-500 animate-pulse mt-20">
        Lade Raum...
      </div>
    );

  const amIImposter = roomData.imposter === playerName;
  const activePlayerName =
    roomData.turnOrder && roomData.currentTurnIndex !== undefined
      ? roomData.turnOrder[roomData.currentTurnIndex]
      : "";
  const isMyTurn = activePlayerName === playerName;

  const cardStyles =
    "w-full shadow-2xl border-slate-200 bg-white/95 backdrop-blur-xl animate-in fade-in slide-in-from-bottom-8 duration-500";

  // ==========================================
  // ANSICHT 1: DAS SPIEL LÄUFT
  // ==========================================
  if (roomData.status === "playing") {
    return (
      <Card className={cardStyles}>
        <CardHeader className="text-center pb-2">
          <CardTitle className="text-3xl font-black text-slate-800">
            Runde {roomData.round}
          </CardTitle>
          <CardDescription className="text-slate-500 font-medium">
            Findet den Imposter!
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6 text-center">
          <div
            className={`p-6 rounded-xl border-2 shadow-sm animate-in zoom-in-95 duration-700 delay-150 fill-mode-backwards ${
              amIImposter
                ? "bg-red-50 border-red-200"
                : "bg-green-50 border-green-200"
            }`}
          >
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">
              Deine geheime Rolle
            </h2>
            {amIImposter ? (
              <div>
                <span className="text-5xl font-black text-red-600 block mb-2">
                  IMPOSTER
                </span>
                <p className="text-red-800 font-medium">
                  Du kennst das Wort nicht! Tarn dich.
                </p>
                <div className="bg-white p-4 rounded-lg border border-red-100 mt-4 inline-block shadow-sm">
                  <span className="text-xs font-bold text-slate-400 uppercase block mb-1">
                    Dein Hinweis
                  </span>
                  <span className="text-xl font-bold text-slate-800 tracking-wide">
                    {roomData.hint}
                  </span>
                </div>
              </div>
            ) : (
              <div>
                <span className="text-lg font-bold text-slate-600 block mb-1">
                  Das geheime Wort:
                </span>
                <span className="text-5xl font-black text-green-600 block">
                  {roomData.word}
                </span>
                <p className="text-green-800 mt-2 font-medium">
                  Verrate nicht zu viel!
                </p>
              </div>
            )}
          </div>

          <div className="bg-slate-50 p-6 rounded-xl border border-slate-200 shadow-inner overflow-hidden">
            <div className="mb-4 flex flex-col items-center border-b border-slate-200 pb-8 pt-4">
              <span className="text-xs text-slate-500 uppercase tracking-widest block mb-4">
                Verbleibende Zeit
              </span>
              <div
                className={`text-6xl font-mono font-black transition-all duration-300 ${
                  timeLeft <= 5
                    ? "text-red-600 scale-125 animate-bounce drop-shadow-md"
                    : timeLeft <= 10
                      ? "text-orange-500 scale-110 animate-pulse"
                      : "text-slate-800"
                }`}
              >
                00:{timeLeft.toString().padStart(2, "0")}
              </div>
            </div>

            <div className="mb-6 mt-4">
              <span className="text-xs text-slate-500 uppercase tracking-widest block mb-1">
                Am Zug
              </span>
              <div
                className={`text-3xl font-black transition-all duration-300 ${
                  isMyTurn
                    ? "text-blue-600 scale-110 drop-shadow-sm"
                    : "text-slate-700"
                }`}
              >
                {isMyTurn ? "Du bist dran!" : `${activePlayerName} spricht...`}
              </div>
            </div>

            {isMyTurn ? (
              <Button
                onClick={handleNextTurn}
                className="w-full h-14 text-lg font-bold bg-blue-600 hover:bg-blue-700 hover:scale-[1.02] active:scale-95 transition-all shadow-md"
              >
                Wort gesagt (Nächster)
              </Button>
            ) : (
              <div className="animate-pulse text-sm font-semibold text-slate-500 bg-white px-6 py-3 rounded-full border border-slate-200 inline-block shadow-sm">
                Hör gut zu...
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  // ==========================================
  // ANSICHT 2: ABSTIMMUNG
  // ==========================================
  if (roomData.status === "voting") {
    const myVote = roomData.votes?.[playerName];
    return (
      <Card className={cardStyles}>
        <CardHeader className="text-center">
          <CardTitle className="text-3xl font-black text-red-600">
            Abstimmung!
          </CardTitle>
          <CardDescription className="text-slate-600 text-md font-medium">
            Wer lügt?
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center space-y-6">
          {myVote ? (
            <div className="bg-slate-50 p-8 rounded-xl border border-slate-200 animate-in zoom-in-95">
              <span className="text-5xl block mb-4 animate-bounce">⏱️</span>
              <h3 className="font-bold text-slate-800 text-xl mb-2">
                Stimme abgegeben!
              </h3>
              <p className="text-slate-500">
                Warte auf den Rest... (
                {Object.keys(roomData.votes || {}).length} /{" "}
                {roomData.players.length})
              </p>
            </div>
          ) : (
            <div className="space-y-4 animate-in fade-in duration-700 delay-150 fill-mode-backwards">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {roomData.players
                  .filter((p) => p.name !== playerName)
                  .map((p) => (
                    <Button
                      key={p.name}
                      onClick={() => handleVote(p.name)}
                      className="h-14 text-lg font-bold bg-white text-slate-700 border-2 border-slate-200 hover:border-slate-400 hover:bg-slate-50 transition-all hover:scale-[1.03]"
                    >
                      {p.name}
                    </Button>
                  ))}
              </div>
              <div className="pt-4 border-t border-slate-100">
                <Button
                  onClick={() => handleVote("SKIP")}
                  variant="outline"
                  className="w-full h-14 text-lg font-bold text-slate-500 hover:text-slate-800 transition-all hover:bg-slate-100"
                >
                  Niemanden (Überspringen)
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // ==========================================
  // ANSICHT 3: SPIELENDE
  // ==========================================
  if (roomData.status === "finished") {
    const isImposterCaught = roomData.votedOut === roomData.imposter;
    return (
      <Card className={cardStyles}>
        <CardHeader className="text-center pb-2">
          <CardTitle className="text-4xl font-black text-slate-800">
            Ergebnis
          </CardTitle>
        </CardHeader>
        <CardContent className="text-center space-y-6">
          <div
            className={`p-8 rounded-xl animate-in zoom-in-95 duration-500 border ${isImposterCaught ? "bg-green-100 border-green-200" : "bg-red-100 border-red-200"}`}
          >
            <h2
              className={`text-4xl font-black mb-4 ${isImposterCaught ? "text-green-700" : "text-red-700"}`}
            >
              {isImposterCaught ? "Gewonnen! 🎉" : "Verloren! 💀"}
            </h2>
            <p className="text-lg text-slate-700">
              Gewählt wurde:{" "}
              <span className="font-bold text-slate-900">
                {roomData.votedOut}
              </span>
            </p>
            <p className="mt-2 text-md font-medium text-slate-600">
              {isImposterCaught
                ? "Der Imposter wurde erwischt."
                : "Ein Unschuldiger wurde verbannt. Der Imposter gewinnt!"}
            </p>
          </div>
          <div className="bg-slate-50 p-6 rounded-xl border border-slate-200 text-left space-y-3 shadow-inner">
            <p className="flex justify-between items-center">
              <span className="text-slate-500 font-bold uppercase text-xs tracking-wider">
                Wort
              </span>{" "}
              <span className="font-black text-slate-800 text-xl">
                {roomData.word}
              </span>
            </p>
            <p className="flex justify-between items-center">
              <span className="text-slate-500 font-bold uppercase text-xs tracking-wider">
                Imposter
              </span>{" "}
              <span className="font-black text-red-600 text-xl">
                {roomData.imposter}
              </span>
            </p>
          </div>
          {isHost ? (
            <Button
              onClick={handleBackToLobby}
              className="w-full h-14 text-lg font-bold hover:scale-[1.02] transition-all"
            >
              Zurück zur Lobby
            </Button>
          ) : (
            <p className="text-slate-500 text-sm animate-pulse font-medium">
              Warte auf den Host...
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  // ==========================================
  // ANSICHT 4: LOBBY
  // ==========================================
  return (
    <Card className={cardStyles}>
      <CardHeader className="text-center">
        <CardTitle className="text-3xl font-black text-slate-800">
          Warteraum
        </CardTitle>
        <CardDescription className="text-slate-500">
          Code:{" "}
          <span className="font-black text-slate-800 text-xl tracking-widest ml-2 bg-slate-100 px-3 py-1 rounded-md border border-slate-200">
            {roomId}
          </span>
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="bg-slate-50 p-5 rounded-xl border border-slate-200 shadow-inner">
          <h3 className="font-bold text-slate-500 mb-4 border-b border-slate-200 pb-2 text-xs uppercase tracking-widest">
            Spieler ({roomData.players.length}/5)
          </h3>
          <ul className="space-y-2">
            {roomData.players.map((player, index) => (
              // FIX 2: Aus fillMode wurde animationFillMode
              <li
                key={index}
                className="flex justify-between items-center bg-white p-3 rounded-lg border border-slate-200 shadow-sm animate-in slide-in-from-left-4 fade-in duration-300"
                style={{
                  animationDelay: `${index * 100}ms`,
                  animationFillMode: "backwards",
                }}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`font-bold ${player.name === playerName ? "text-blue-600" : "text-slate-700"}`}
                  >
                    {player.name} {player.name === playerName && "(Du)"}
                  </span>
                  {player.isHost && (
                    <span className="text-[10px] font-black uppercase tracking-wider bg-blue-100 text-blue-700 px-2 py-1 rounded">
                      Host
                    </span>
                  )}
                </div>
                {isHost && !player.isHost && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleKickPlayer(player)}
                    className="h-8 text-xs font-bold transition-transform hover:scale-105"
                  >
                    Kick
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>

        {isHost ? (
          <Button
            className="w-full h-14 text-lg font-bold bg-blue-600 hover:bg-blue-700 hover:scale-[1.02] active:scale-95 transition-all shadow-md"
            disabled={roomData.players.length < 3}
            onClick={handleStartGame}
          >
            {roomData.players.length < 3
              ? "Warte auf Spieler (Mind. 3)"
              : "Spiel starten"}
          </Button>
        ) : (
          <div className="text-center text-sm font-bold tracking-wider text-slate-500 bg-slate-50 py-4 rounded-lg border border-slate-200 animate-pulse">
            Warte auf den Host...
          </div>
        )}
      </CardContent>
    </Card>
  );
}
