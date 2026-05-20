import { Route, Routes } from "react-router-dom";
import AppLayout from "./components/AppLayout.jsx";
import Home from "./pages/Home.jsx";
import Library from "./pages/Library.jsx";
import MovieDetail from "./pages/MovieDetail.jsx";
import ShowDetail from "./pages/ShowDetail.jsx";
import Watch from "./pages/Watch.jsx";
import SearchResults from "./pages/SearchResults.jsx";
import Admin from "./pages/Admin.jsx";
import { BulkTmdbProvider } from "./lib/bulkTmdb.jsx";

export default function App() {
  return (
    <BulkTmdbProvider>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<Home />} />
          <Route path="movies" element={<Library type="movie" />} />
          <Route path="movies/:id" element={<MovieDetail />} />
          <Route path="shows" element={<Library type="tv" />} />
          <Route path="shows/:id" element={<ShowDetail />} />
          <Route path="search" element={<SearchResults />} />
          <Route path="admin" element={<Admin />} />
        </Route>
        <Route path="watch/:fileId" element={<Watch />} />
      </Routes>
    </BulkTmdbProvider>
  );
}
