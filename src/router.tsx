import { Navigate, Route, Routes } from 'react-router-dom';
import { GamePage } from './routes/GamePage';
import { HomePage } from './routes/HomePage';

export function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/play" element={<GamePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
