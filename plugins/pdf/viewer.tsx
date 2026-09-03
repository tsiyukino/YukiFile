/**
 * A PDF, rendered.
 *
 * The first consumer of the viewer slot. It knows the object and it knows it
 * has a rectangle to draw in; it does not know whether that rectangle is
 * embedded in the page or covering the window, and nothing in what it receives
 * would tell it.
 *
 * # It renders a file it cannot read
 *
 * `api.fileUrl` returns a URL rather than bytes. pdf.js fetches it through the
 * webview, so the document goes from disk to a canvas without passing through
 * this plugin's JavaScript. A plugin that could read the bytes and also call
 * `importPropose` could encode what it read into what it proposes; this shape
 * removes the first half.
 */

import { Button, Spinner, Stack, Text } from "@primer/react";
import { useEffect, useRef, useState } from "react";

import type { PanelProps } from "../../src/plugin-host/panel.js";
import { clampPage, isProblem, sourceFor } from "./pdf.js";

export default function PdfViewer({ api, objectId }: PanelProps): React.JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let current = true;
    // The loading task owns the worker, so destroying it is what frees
    // the document. `PDFDocumentProxy` has no destroy of its own.
    let loading: { destroy: () => Promise<void> } | undefined;

    const draw = async (): Promise<void> => {
      setBusy(true);

      const object = await api.objectFlat(objectId);
      const source = await sourceFor(api, object);
      if (!current) return;

      if (isProblem(source)) {
        setProblem(source.problem);
        setBusy(false);
        return;
      }

      // Imported here rather than at the top so the several megabytes of
      // pdf.js load when somebody opens a PDF, not when the application
      // starts. A viewer nobody opened should cost nothing.
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.mjs",
        import.meta.url,
      ).toString();

      try {
        const task = pdfjs.getDocument({ url: source.url });
        loading = task;
        const opened = await task.promise;
        if (!current) return;

        setPages(opened.numPages);

        const shown = await opened.getPage(clampPage(page, opened.numPages));
        const target = canvas.current;
        if (!current || !target) return;

        const viewport = shown.getViewport({ scale: 1.5 });
        target.width = viewport.width;
        target.height = viewport.height;

        const context = target.getContext("2d");
        if (!context) {
          setProblem("This window cannot draw a PDF.");
          return;
        }

        await shown.render({ canvas: target, canvasContext: context, viewport }).promise;
      } catch (thrown) {
        if (current) setProblem(String(thrown));
      } finally {
        if (current) setBusy(false);
      }
    };

    void draw();

    return () => {
      current = false;
      // A task left open holds its worker and its buffers. Closing a viewer
      // should not cost memory for the life of the session.
      void loading?.destroy();
    };
  }, [api, objectId, page]);

  if (problem) return <Text size="small">{problem}</Text>;

  return (
    <Stack gap="condensed">
      <Stack direction="horizontal" gap="condensed" align="center">
        <Button disabled={page <= 1 || busy} onClick={() => setPage((n) => n - 1)}>
          Previous
        </Button>
        <Text size="small">
          {pages > 0 ? `page ${page} of ${pages}` : "opening…"}
        </Text>
        <Button disabled={page >= pages || busy} onClick={() => setPage((n) => n + 1)}>
          Next
        </Button>
        {busy && <Spinner size="small" aria-label="Rendering the page" />}
      </Stack>

      <canvas ref={canvas} style={{ maxWidth: "100%" }} />
    </Stack>
  );
}
