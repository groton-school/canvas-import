import { JSONValue } from '@battis/typescript-tricks';
import * as Canvas from '@groton/canvas-types';
import ejs from 'ejs';
import path from 'node:path';
import * as Files from './Files.js';

type ToCanvasArgsOptions = {
  course: Canvas.Courses.Model;
  title: string;
  body: JSONValue[];
  layout: number;
  front_page?: boolean;
};

export async function toCanvasArgs({
  course,
  title,
  body,
  layout,
  front_page = false
}: ToCanvasArgsOptions): Promise<Canvas.Pages.Parameters> {
  const page = await Promise.all(
    body?.map(
      async (entry) => await Files.uploadLocalFiles({ course, entry })
    ) || []
  );
  return {
    'wiki_page[title]': title,
    'wiki_page[body]': await ejs.renderFile(
      path.join(import.meta.dirname, 'PodiumPage.ejs'),
      {
        page,
        layout
      }
    ),
    'wiki_page[published]': true,
    'wiki_page[front_page]': front_page
  };
}
