import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import Room from "./pages/Room";

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <Routes>
            {/* Startseite */}
            <Route path="/" element={<Home />} />
            {/* Spielraum (die :roomId ist eine dynamische Variable) */}
            <Route path="/room/:roomId" element={<Room />} />
          </Routes>
        </div>
      </div>
    </Router>
  );
}

export default App;
