import { Navigate, useParams } from "react-router-dom";

export function BookRedirect() {
  const { bookId } = useParams<{ bookId: string }>();
  return <Navigate to={`/books/${bookId}/studio`} replace />;
}
