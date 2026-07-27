import { Redirect } from "expo-router";

import { useAuth } from "../src/auth/AuthProvider";

export default function HomeScreen() {
  const { isLoading, session } = useAuth();

  if (isLoading) {
    return null;
  }

  return <Redirect href={session ? "/dashboard" : "/login"} />;
}
