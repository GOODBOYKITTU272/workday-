import { Redirect } from "expo-router";

import { useAuth } from "../src/auth/AuthProvider";
import { getAuthRedirect } from "../src/auth/model";

export default function HomeScreen() {
  const { isLoading, session } = useAuth();
  const redirect = getAuthRedirect({ hasSession: Boolean(session), isLoading, pathname: "/" });

  if (!redirect) {
    return null;
  }

  return <Redirect href={redirect} />;
}
