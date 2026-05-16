import { useEffect, useMemo, useState } from "react";
import { format, subDays } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, MousePointerClick, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type LandingStat = { source: string; visit_count: number; unique_campaigns: number };
type LandingVisit = {
  id: string;
  created_at: string;
  source: "google_ads" | "google_organic";
  landing_path: string;
  gclid: string | null;
  utm_campaign: string | null;
  utm_source: string | null;
  referrer: string | null;
};

const RANGES = [
  { label: "24h", days: 1 },
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
];

const PAGE_SIZE = 50;

export default function GoogleTrafficSection() {
  const [days, setDays] = useState(7);
  const [sourceFilter, setSourceFilter] = useState<"all" | "google_ads" | "google_organic">("all");
  const [stats, setStats] = useState<LandingStat[]>([]);
  const [visits, setVisits] = useState<LandingVisit[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const { toast } = useToast();

  const range = useMemo(() => {
    const to = new Date();
    const from = subDays(to, days);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [days]);

  useEffect(() => { setPage(0); }, [days, sourceFilter]);

  useEffect(() => {
    (async () => {
      try {
        const [statsRes, listRes] = await Promise.all([
          supabase.functions.invoke("admin-api", {
            body: { action: "get_landing_stats", date_from: range.from, date_to: range.to },
          }),
          supabase.functions.invoke("admin-api", {
            body: {
              action: "list_landing_visits",
              date_from: range.from,
              date_to: range.to,
              source: sourceFilter,
              limit: PAGE_SIZE,
              offset: page * PAGE_SIZE,
            },
          }),
        ]);
        if (statsRes.error) throw statsRes.error;
        if (listRes.error) throw listRes.error;
        setStats((statsRes.data ?? []) as LandingStat[]);
        setVisits(((listRes.data?.rows) ?? []) as LandingVisit[]);
        setTotal(Number(listRes.data?.total ?? 0));
      } catch (e: any) {
        toast({ title: "Error loading Google traffic", description: e.message, variant: "destructive" });
      }
    })();
  }, [range, sourceFilter, page, toast]);

  const adsCount = stats.find((s) => s.source === "google_ads")?.visit_count ?? 0;
  const organicCount = stats.find((s) => s.source === "google_organic")?.visit_count ?? 0;
  const campaigns =
    stats.find((s) => s.source === "google_ads")?.unique_campaigns ?? 0;
  const totalVisits = Number(adsCount) + Number(organicCount);

  const cards = [
    { title: "Total visits", value: totalVisits, icon: TrendingUp },
    { title: "Google Ads", value: adsCount, icon: MousePointerClick },
    { title: "Organic search", value: organicCount, icon: Search },
    { title: "Campaigns", value: campaigns, icon: TrendingUp },
  ];

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <TrendingUp className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-bold">Google Traffic</h2>
        <div className="ml-auto flex gap-1">
          {RANGES.map((r) => (
            <Button
              key={r.label}
              variant={days === r.days ? "default" : "ghost"}
              size="sm"
              onClick={() => setDays(r.days)}
            >
              {r.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => (
          <Card key={c.title}>
            <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm font-medium text-muted-foreground">{c.title}</CardTitle>
              <c.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{c.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex gap-1">
        {(["all", "google_ads", "google_organic"] as const).map((s) => (
          <Button
            key={s}
            variant={sourceFilter === s ? "default" : "outline"}
            size="sm"
            onClick={() => setSourceFilter(s)}
          >
            {s === "all" ? "All" : s === "google_ads" ? "Google Ads" : "Organic"}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Recent Visits</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {visits.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No Google-sourced visits in this range yet.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left py-2 pr-4">When</th>
                  <th className="text-left py-2 pr-4">Source</th>
                  <th className="text-left py-2 pr-4">Campaign</th>
                  <th className="text-left py-2 pr-4">Path</th>
                  <th className="text-left py-2 pr-4">gclid</th>
                  <th className="text-left py-2">Referrer</th>
                </tr>
              </thead>
              <tbody>
                {visits.map((v) => (
                  <tr key={v.id} className="border-b border-border/50">
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {format(new Date(v.created_at), "MMM d, HH:mm")}
                    </td>
                    <td className="py-2 pr-4">
                      <Badge variant={v.source === "google_ads" ? "default" : "secondary"}>
                        {v.source === "google_ads" ? "Ads" : "Organic"}
                      </Badge>
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs">{v.utm_campaign || "—"}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{v.landing_path}</td>
                    <td className="py-2 pr-4 font-mono text-xs truncate max-w-[140px]">
                      {v.gclid ? v.gclid.slice(0, 16) + "…" : "—"}
                    </td>
                    <td className="py-2 text-xs text-muted-foreground truncate max-w-[260px]">
                      {v.referrer || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between pt-3 text-sm">
              <span className="text-muted-foreground">
                Page {page + 1} of {pageCount} ({total} total)
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page + 1 >= pageCount}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
