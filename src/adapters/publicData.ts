import { verifyArcticShiftConnection } from "@/adapters/leadDiscovery";
import { verifyPropertyEvidenceConnection } from "@/adapters/propertyData";

export interface PublicDataLaneHealth {
  id: "PUBLIC_SEARCH" | "PROPERTY_EVIDENCE";
  label: string;
  ok: boolean;
  message: string;
}

export interface PublicDataHealth {
  ok: boolean;
  message: string;
  lanes: PublicDataLaneHealth[];
}

type LaneVerifier = () => Promise<{ ok: boolean; message: string }>;

function settledLane(
  id: PublicDataLaneHealth["id"],
  label: string,
  result: PromiseSettledResult<{ ok: boolean; message: string }>
): PublicDataLaneHealth {
  if (result.status === "fulfilled") return { id, label, ...result.value };
  return {
    id,
    label,
    ok: false,
    message: result.reason instanceof Error ? result.reason.message : "Health check failed.",
  };
}

/**
 * Shared public-data health boundary. The two providers start together and
 * settle independently, so a slow archive cannot prevent property checks and
 * a county/FHFA outage cannot disable lead discovery.
 */
export async function verifyPublicDataIntegration(
  verifyPublicSearch: LaneVerifier = verifyArcticShiftConnection,
  verifyPropertyEvidence: LaneVerifier = verifyPropertyEvidenceConnection
): Promise<PublicDataHealth> {
  const [searchResult, propertyResult] = await Promise.allSettled([
    verifyPublicSearch(),
    verifyPropertyEvidence(),
  ]);
  const lanes = [
    settledLane("PUBLIC_SEARCH", "Arctic Shift public search", searchResult),
    settledLane("PROPERTY_EVIDENCE", "Property records", propertyResult),
  ];
  return {
    ok: lanes.every((lane) => lane.ok),
    message: lanes.map((lane) => `${lane.label}: ${lane.message}`).join(" "),
    lanes,
  };
}
