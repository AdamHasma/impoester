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

// UI Komponenten
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
  status: string; // "lobby", "playing", "voting", "finished"
  players: Player[];
  word?: string;
  hint?: string;
  imposter?: string;
  currentTurnIndex?: number;
  votes?: Record<string, string>; // Speichert, wer wen gewählt hat { "Spieler1": "Spieler2", "Spieler2": "SKIP" }
  votedOut?: string; // Wer am Ende rausgeflogen ist
  round?: number; // Welche Diskussionsrunde haben wir gerade?
}

export default function Room() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const playerName = localStorage.getItem("playerName") || "";

  const [roomData, setRoomData] = useState<RoomData | null>(null);
  const [error, setError] = useState("");
  const [hasJoined, setHasJoined] = useState(false);

  // --- 1. RAUM BETRETEN & LISTEN ---
  useEffect(() => {
    if (!roomId || !playerName) {
      navigate("/");
      return;
    }

    const roomRef = doc(db, "rooms", roomId);

    const joinRoom = async () => {
      try {
        const snap = await getDoc(roomRef);
        if (!snap.exists()) {
          setError("Diesen Raum-Code gibt es nicht.");
          return;
        }

        const data = snap.data() as RoomData;
        const isAlreadyInRoom = data.players.some((p) => p.name === playerName);

        if (isAlreadyInRoom) {
          setHasJoined(true);
        } else {
          if (data.players.length >= 5) {
            setError("Der Raum ist leider voll (Maximal 5 Spieler).");
            return;
          }
          await updateDoc(roomRef, {
            players: arrayUnion({ name: playerName, isHost: false }),
          });
          setHasJoined(true);
        }
      } catch (err) {
        console.error("Fehler beim Beitreten:", err);
        setError("Ein Fehler ist aufgetreten.");
      }
    };

    joinRoom();

    const unsubscribe = onSnapshot(roomRef, (snap) => {
      if (snap.exists()) {
        setRoomData(snap.data() as RoomData);
      } else {
        setError("Der Raum wurde geschlossen.");
      }
    });

    return () => unsubscribe();
  }, [roomId, playerName, navigate]);

  // --- 2. KICK-ERKENNUNG ---
  useEffect(() => {
    if (hasJoined && roomData) {
      const amIStillInRoom = roomData.players.some(
        (p) => p.name === playerName,
      );
      if (!amIStillInRoom) {
        alert("Du wurdest vom Host aus dem Raum entfernt.");
        navigate("/");
      }
    }
  }, [roomData, hasJoined, playerName, navigate]);

  const handleKickPlayer = async (playerToKick: Player) => {
    if (!roomId) return;
    try {
      const roomRef = doc(db, "rooms", roomId);
      await updateDoc(roomRef, { players: arrayRemove(playerToKick) });
    } catch (error) {
      console.error("Fehler beim Kicken:", error);
    }
  };

  // --- 3. SPIEL STARTEN (Nur Host) ---
  const handleStartGame = async () => {
    if (!roomId || !roomData) return;

    const randomWordIndex = Math.floor(Math.random() * gameWords.length);
    const selectedWord = gameWords[randomWordIndex];

    const randomPlayerIndex = Math.floor(
      Math.random() * roomData.players.length,
    );
    const selectedImposterName = roomData.players[randomPlayerIndex].name;

    try {
      const roomRef = doc(db, "rooms", roomId);
      await updateDoc(roomRef, {
        status: "playing",
        word: selectedWord.word,
        hint: selectedWord.hint,
        imposter: selectedImposterName,
        currentTurnIndex: 0,
        round: 1, // Wir starten in Runde 1
        votes: {},
        votedOut: "",
      });
    } catch (error) {
      console.error("Fehler beim Spielstart:", error);
    }
  };

  // --- 4. RUNDEN-LOGIK ---
  const handleNextTurn = async () => {
    if (!roomId || !roomData || roomData.currentTurnIndex === undefined) return;

    const nextIndex = roomData.currentTurnIndex + 1;
    const roomRef = doc(db, "rooms", roomId);

    try {
      if (nextIndex >= roomData.players.length) {
        await updateDoc(roomRef, {
          status: "voting",
          votes: {}, // Wir leeren die Stimmen für die Abstimmung
        });
      } else {
        await updateDoc(roomRef, { currentTurnIndex: nextIndex });
      }
    } catch (error) {
      console.error("Fehler beim Rundenwechsel:", error);
    }
  };

  // --- 5. ABSTIMMEN (Jeder Spieler wählt) ---
  const handleVote = async (targetName: string) => {
    if (!roomId) return;
    try {
      const roomRef = doc(db, "rooms", roomId);
      // Speichert die Stimme für genau diesen Spieler (z.B. votes.Max = "SKIP")
      await updateDoc(roomRef, {
        [`votes.${playerName}`]: targetName,
      });
    } catch (error) {
      console.error("Fehler beim Abstimmen:", error);
    }
  };

  // --- 6. AUSWERTUNG DER STIMMEN (Nur der Host macht das im Hintergrund) ---
  const isHost = roomData?.players.find((p) => p.name === playerName)?.isHost;

  useEffect(() => {
    // Nur der Host berechnet das Ergebnis, sobald alle abgestimmt haben!
    if (!isHost || !roomData || roomData.status !== "voting" || !roomData.votes)
      return;

    const voteCount = Object.keys(roomData.votes).length;

    // Haben alle Spieler abgestimmt?
    if (voteCount > 0 && voteCount === roomData.players.length) {
      // 1. Stimmen zählen
      const tally: Record<string, number> = {};
      Object.values(roomData.votes).forEach((vote) => {
        tally[vote] = (tally[vote] || 0) + 1;
      });

      // 2. Herausfinden, wer die meisten Stimmen hat
      let maxVotes = 0;
      let candidate = "";
      let isTie = false;

      for (const [name, count] of Object.entries(tally)) {
        if (count > maxVotes) {
          maxVotes = count;
          candidate = name;
          isTie = false;
        } else if (count === maxVotes) {
          isTie = true; // Unentschieden!
        }
      }

      const roomRef = doc(db, "rooms", roomId!);

      // 3. Entscheidung treffen
      if (isTie || candidate === "SKIP") {
        // Unentschieden ODER Mehrheit hat "Überspringen" gewählt -> Neue Runde!
        updateDoc(roomRef, {
          status: "playing",
          currentTurnIndex: 0, // Wieder beim Ersten anfangen
          round: (roomData.round || 1) + 1, // Rundenzähler hochsetzen
          votes: {},
        });
      } else {
        // Klare Mehrheit für jemanden -> Spiel beenden
        updateDoc(roomRef, {
          status: "finished",
          votedOut: candidate,
        });
      }
    }
  }, [roomData, isHost, roomId]);

  // --- 7. ZURÜCK ZUR LOBBY (Nach dem Spiel) ---
  const handleBackToLobby = async () => {
    if (!roomId) return;
    await updateDoc(doc(db, "rooms", roomId), {
      status: "lobby",
      currentTurnIndex: 0,
      votes: {},
      votedOut: "",
      word: "",
      hint: "",
      imposter: "",
    });
  };

  // ==========================================
  // UI RENDERING
  // ==========================================

  if (error) {
    return (
      <Card className="border-red-500">
        <CardHeader>
          <CardTitle className="text-red-500">Fehler</CardTitle>
        </CardHeader>
        <CardContent>
          <p>{error}</p>
          <Button className="mt-4" onClick={() => navigate("/")}>
            Zurück
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!roomData)
    return (
      <div className="text-center font-semibold text-slate-600">
        Lade Raum...
      </div>
    );

  const amIImposter = roomData.imposter === playerName;
  const activePlayerName =
    roomData.currentTurnIndex !== undefined
      ? roomData.players[roomData.currentTurnIndex]?.name
      : "";
  const isMyTurn = activePlayerName === playerName;

  // ANSICHT 1: DAS SPIEL LÄUFT (Wörter sagen)
  if (roomData.status === "playing") {
    return (
      <Card className="w-full">
        <CardHeader className="text-center pb-2">
          <CardTitle className="text-3xl font-bold text-slate-800">
            Diskussions-Runde {roomData.round}
          </CardTitle>
          <CardDescription className="text-md mt-2">
            Findet den Imposter!
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6 text-center">
          <div
            className={`p-6 rounded-lg border-2 ${amIImposter ? "bg-red-50 border-red-200" : "bg-green-50 border-green-200"}`}
          >
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-2">
              Deine geheime Rolle
            </h2>
            {amIImposter ? (
              <div>
                <span className="text-4xl font-extrabold text-red-600 block mb-2">
                  IMPOSTER
                </span>
                <p className="text-red-800 font-medium">
                  Du kennst das Wort nicht! Versuche dich anzupassen.
                </p>
                <div className="bg-white p-4 rounded-md border border-red-100 mt-4 inline-block">
                  <span className="text-xs font-bold text-slate-400 uppercase block mb-1">
                    Dein Hinweis
                  </span>
                  <span className="text-xl font-bold text-slate-800">
                    {roomData.hint}
                  </span>
                </div>
              </div>
            ) : (
              <div>
                <span className="text-2xl font-bold text-slate-700 block mb-1">
                  Das geheime Wort ist:
                </span>
                <span className="text-4xl font-extrabold text-green-700 block">
                  {roomData.word}
                </span>
                <p className="text-green-800 mt-2 font-medium">
                  Lass den Imposter nicht wissen, worum es geht!
                </p>
              </div>
            )}
          </div>

          <div className="bg-slate-50 p-6 rounded-md border border-slate-200 shadow-inner">
            <div className="mb-4">
              <span className="text-sm text-slate-500 uppercase tracking-wider block mb-1">
                Aktuell am Zug:
              </span>
              <div
                className={`text-2xl font-bold ${isMyTurn ? "text-blue-600" : "text-slate-800"}`}
              >
                {isMyTurn ? "Du bist dran!" : `${activePlayerName} ist dran`}
              </div>
            </div>

            {isMyTurn ? (
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Button
                  onClick={handleNextTurn}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  Wort gesagt
                </Button>
                <Button onClick={handleNextTurn} variant="outline">
                  Überspringen
                </Button>
              </div>
            ) : (
              <div className="animate-pulse text-sm text-slate-500 bg-white p-3 rounded border border-slate-200 inline-block">
                Warte, bis {activePlayerName} ein Wort gesagt hat...
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  // ANSICHT 2: ABSTIMMUNG (Voting)
  if (roomData.status === "voting") {
    // Prüfen, ob ich schon abgestimmt habe
    const myVote = roomData.votes?.[playerName];
    const voteCount = roomData.votes ? Object.keys(roomData.votes).length : 0;

    return (
      <Card className="w-full">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl font-bold text-slate-800">
            Zeit zur Abstimmung!
          </CardTitle>
          <CardDescription className="text-lg">
            Wer ist eurer Meinung nach der Imposter?
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center space-y-6">
          {myVote ? (
            <div className="bg-slate-50 p-6 rounded-md border border-slate-200">
              <span className="text-4xl block mb-4">⏱️</span>
              <h3 className="font-bold text-slate-700 text-lg mb-2">
                Stimme abgegeben!
              </h3>
              <p className="text-slate-500">
                Warte auf die anderen Spieler... ({voteCount} /{" "}
                {roomData.players.length} haben abgestimmt)
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="font-semibold text-slate-700">Wähle weise:</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {roomData.players
                  .filter((p) => p.name !== playerName) // Sich selbst aus der Liste filtern
                  .map((p) => (
                    <Button
                      key={p.name}
                      onClick={() => handleVote(p.name)}
                      className="h-12 text-lg"
                      variant="secondary"
                    >
                      {p.name}
                    </Button>
                  ))}
              </div>
              <div className="pt-4 border-t border-slate-100">
                <Button
                  onClick={() => handleVote("SKIP")}
                  variant="outline"
                  className="w-full h-12 text-lg"
                >
                  Niemanden (Abstimmung überspringen)
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // ANSICHT 3: SPIELENDE (Finished)
  if (roomData.status === "finished") {
    const isImposterCaught = roomData.votedOut === roomData.imposter;

    return (
      <Card className="w-full">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl font-bold text-slate-800">
            Spiel vorbei!
          </CardTitle>
        </CardHeader>
        <CardContent className="text-center space-y-6">
          <div
            className={`p-6 rounded-lg ${isImposterCaught ? "bg-green-100" : "bg-red-100"}`}
          >
            <h2
              className={`text-2xl font-bold mb-2 ${isImposterCaught ? "text-green-800" : "text-red-800"}`}
            >
              {isImposterCaught ? "Gewonnen! 🎉" : "Verloren! 💀"}
            </h2>
            <p className="text-lg text-slate-800">
              Die Gruppe hat{" "}
              <span className="font-bold">{roomData.votedOut}</span>{" "}
              rausgeworfen.
            </p>
            <p className="mt-2 text-md font-medium">
              {isImposterCaught
                ? "Das war die absolut richtige Entscheidung!"
                : "Das war leider ein Unschuldiger. Der Imposter hat gewonnen."}
            </p>
          </div>

          <div className="bg-slate-50 p-4 rounded-md border border-slate-200 text-left space-y-2">
            <p>
              <span className="text-slate-500 w-24 inline-block">Wort:</span>{" "}
              <span className="font-bold text-lg">{roomData.word}</span>
            </p>
            <p>
              <span className="text-slate-500 w-24 inline-block">
                Imposter:
              </span>{" "}
              <span className="font-bold text-lg">{roomData.imposter}</span>
            </p>
          </div>

          {isHost ? (
            <Button onClick={handleBackToLobby} className="w-full mt-4">
              Zurück zur Lobby (Neue Runde)
            </Button>
          ) : (
            <p className="text-slate-500 text-sm mt-4">
              Warte darauf, dass der Host eine neue Runde in der Lobby
              startet...
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  // ANSICHT 4: DER WARTERAUM (Lobby)
  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-3xl font-bold">Warteraum</CardTitle>
        <CardDescription>
          Raum-Code:{" "}
          <span className="font-bold text-slate-800 text-lg">{roomId}</span>
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="bg-slate-100 p-4 rounded-md">
          <h3 className="font-semibold text-slate-700 mb-3 border-b pb-2">
            Spieler ({roomData.players.length}/5)
          </h3>
          <ul className="space-y-2">
            {roomData.players.map((player, index) => (
              <li
                key={index}
                className="flex justify-between items-center bg-white p-2 rounded border border-slate-200"
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium text-slate-800">
                    {player.name} {player.name === playerName && "(Du)"}
                  </span>
                  {player.isHost && (
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">
                      Host
                    </span>
                  )}
                </div>
                {isHost && !player.isHost && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleKickPlayer(player)}
                    className="h-7 text-xs px-2"
                  >
                    Kicken
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>

        {isHost ? (
          <Button
            className="w-full"
            disabled={roomData.players.length < 3}
            onClick={handleStartGame}
          >
            {roomData.players.length < 3
              ? "Warte auf mehr Spieler (Mind. 3)..."
              : "Spiel starten"}
          </Button>
        ) : (
          <div className="text-center text-sm text-slate-500 bg-slate-50 p-3 rounded">
            Warte darauf, dass der Host das Spiel startet...
          </div>
        )}
      </CardContent>
    </Card>
  );
}
