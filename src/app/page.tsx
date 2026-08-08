import { MktNav } from "@/components/marketing/mkt-nav";
import { Hero } from "@/components/marketing/hero";
import { TrustBar } from "@/components/marketing/trust-bar";
import { RateCalculator } from "@/components/marketing/rate-calculator";
import { ValueProps } from "@/components/marketing/value-props";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { Faq } from "@/components/marketing/faq";
import { CtaBand } from "@/components/marketing/cta-band";
import { MktFooter } from "@/components/marketing/mkt-footer";

export default function Home() {
  return (
    <div className="mkt flex-1 overflow-y-auto">
      <MktNav />
      <main>
        <Hero />
        <TrustBar />
        <RateCalculator />
        <ValueProps />
        <HowItWorks />
        <Faq />
        <CtaBand />
      </main>
      <MktFooter />
    </div>
  );
}
