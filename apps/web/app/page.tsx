import { SiteHeader } from "@/components/landing/SiteHeader";
import { Hero } from "@/components/landing/Hero";
import { ProblemSolution } from "@/components/landing/ProblemSolution";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { FlexibilitySection } from "@/components/landing/FlexibilitySection";
import { FeaturedUseCases } from "@/components/landing/FeaturedUseCases";
import { UseCaseExplorer } from "@/components/landing/UseCaseExplorer";
import { FAQSection } from "@/components/landing/FAQSection";
import { ClosingStatement } from "@/components/landing/ClosingStatement";
import { SiteFooter } from "@/components/landing/SiteFooter";

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <Hero />
        <ProblemSolution />
        <HowItWorks />
        <FlexibilitySection />
        <FeaturedUseCases />
        <UseCaseExplorer />
        <FAQSection />
        <ClosingStatement />
      </main>
      <SiteFooter />
    </>
  );
}
