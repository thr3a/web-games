import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import About from './pages/About';
import Home from './pages/Home';
import NotFound from './pages/NotFound';

const Houdai = lazy(() => import('./pages/Houdai'));
const SubwayRush = lazy(() => import('./pages/SubwayRush'));

const App = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path='/' element={<Home />} />
        <Route path='/about' element={<About />} />
        <Route
          path='/houdai'
          element={
            <Suspense fallback={<p role='status'>ゲームを読み込んでいます…</p>}>
              <Houdai />
            </Suspense>
          }
        />
        <Route
          path='/subway-rush'
          element={
            <Suspense fallback={<p role='status'>ゲームを読み込んでいます…</p>}>
              <SubwayRush />
            </Suspense>
          }
        />
        <Route path='*' element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
