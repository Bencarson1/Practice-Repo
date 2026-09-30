import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve((_req: Request) => {
  return new Response(JSON.stringify({
    error: "AI style variations are disabled on NebedaHub."
  }), {
    status: 410,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
});
