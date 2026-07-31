// Curated major-city lists per supported state, used to constrain the intake
// form's city field to the selected state (F-01 step 5c: state must match
// city, per Aldrish's ask — no random cross-state junk submissions).
// Not exhaustive — a soft datalist + validation set, not a full US gazetteer.

export const STATE_CITIES: Record<string, string[]> = {
  AZ: ["Phoenix", "Tucson", "Mesa", "Chandler", "Scottsdale", "Glendale", "Gilbert", "Tempe", "Peoria", "Surprise"],
  CA: ["Los Angeles", "San Diego", "San Jose", "San Francisco", "Fresno", "Sacramento", "Irvine", "Bakersfield", "Anaheim", "Long Beach", "Oakland", "Riverside"],
  CO: ["Denver", "Colorado Springs", "Aurora", "Fort Collins", "Lakewood", "Boulder", "Pueblo", "Centennial"],
  FL: ["Jacksonville", "Miami", "Tampa", "Orlando", "St. Petersburg", "Fort Lauderdale", "Tallahassee", "Cape Coral", "Port St. Lucie", "Sarasota"],
  GA: ["Atlanta", "Augusta", "Columbus", "Savannah", "Marietta", "Athens", "Sandy Springs", "Roswell"],
  IL: ["Chicago", "Aurora", "Naperville", "Joliet", "Rockford", "Springfield", "Peoria", "Elgin"],
  NC: ["Charlotte", "Raleigh", "Greensboro", "Durham", "Winston-Salem", "Fayetteville", "Cary", "Asheville"],
  NV: ["Las Vegas", "Henderson", "Reno", "North Las Vegas", "Sparks", "Carson City"],
  NY: ["New York", "Buffalo", "Rochester", "Yonkers", "Syracuse", "Albany", "New Rochelle", "Mount Vernon"],
  OH: ["Columbus", "Cleveland", "Cincinnati", "Toledo", "Akron", "Dayton", "Youngstown"],
  OR: ["Portland", "Salem", "Eugene", "Gresham", "Hillsboro", "Bend", "Beaverton"],
  PA: ["Philadelphia", "Pittsburgh", "Allentown", "Erie", "Reading", "Scranton", "Bethlehem"],
  SC: ["Charleston", "Columbia", "North Charleston", "Mount Pleasant", "Rock Hill", "Greenville", "Summerville"],
  TX: ["Houston", "San Antonio", "Dallas", "Austin", "Fort Worth", "El Paso", "Plano", "Arlington", "Corpus Christi", "Irving"],
  WA: ["Seattle", "Spokane", "Tacoma", "Bellevue", "Vancouver", "Everett", "Kent", "Renton"],
};

export function isKnownCity(stateCode: string, city: string): boolean {
  const list = STATE_CITIES[stateCode];
  if (!list) return true; // unknown state code — don't block
  const normalized = city.trim().toLowerCase();
  return list.some((c) => c.toLowerCase() === normalized);
}
