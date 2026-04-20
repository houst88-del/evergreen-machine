"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { GalaxySurface } from "./galaxy-surface";

export default function GalaxyPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/dashboard#starden-panel");
  }, [router]);

  return <GalaxySurface />;
}
