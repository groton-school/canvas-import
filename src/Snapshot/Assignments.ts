import { Log } from '@battis/qui-cli.log';
import { ArrayElement } from '@battis/typescript-tricks';
import type { Item } from '@msar/snapshot-multiple/dist/SnapshotMultiple.d.ts';
import path from 'node:path';
import * as Preferences from '../App/Preferences.js';
import * as Canvas from '../Canvas/index.js';
import * as Files from './Files.js';
import * as IndexFile from './IndexFile.js';
import { Annotated } from './Url.js';

type SnapshotModel = ArrayElement<NonNullable<Item['Assignments']>>;

type GradebookModel = ArrayElement<
  ArrayElement<NonNullable<Item['Gradebook']>>['gradebook']['Assignments']
>;

export type Model = Omit<SnapshotModel, 'ExtraCredit' | 'IncCumGrade'> &
  Partial<GradebookModel>;

export async function hydrate(snapshot: Item) {
  const assignments: Model[] = [];
  for (const snapshotAssignment of snapshot.Assignments || []) {
    const gradebookAssignment = snapshot.Gradebook?.reduce(
      (gradebookAssignment: GradebookModel | undefined, markingPeriod) => {
        if (!gradebookAssignment) {
          return markingPeriod.gradebook.Assignments.reduce(
            (markingPeriodAssignment: GradebookModel | undefined, entry) => {
              if (entry.AssignmentId == snapshotAssignment.id) {
                return entry;
              }
              return markingPeriodAssignment;
            },
            undefined
          );
        }
        return gradebookAssignment;
      },
      undefined
    );
    if (snapshotAssignment) {
      assignments.push({
        ...snapshotAssignment,
        ExtraCredit: undefined,
        IncCumGrade: undefined,
        ...gradebookAssignment
      });
    } else {
      const message = `Assignment unmatched: ${Log.syntaxColor({ snapshotAssignment, gradebookAssignment })}`;
      if (Preferences.ignoreErrors()) {
        Log.warning(message);
      } else {
        throw new Error(message);
      }
    }
  }
  return assignments.sort(
    (a, b) => new Date(a.DueDate).getTime() - new Date(b.DueDate).getTime()
  );
}

function definitionList(items: string[]) {
  if (items.length) {
    return `<dl>${items.map((item) => item.replace('<dd></dd>', '')).join('')}</dl>`;
  }
  return '';
}

type ToCanvasArgsOptions = {
  course: Canvas.Courses.Model;
  assignmentGroups: Canvas.AssigmentGroups.Model[];
  assignment: Model;
  order: number;
};

export async function toCanvasArgs({
  course,
  assignmentGroups,
  assignment,
  order
}: ToCanvasArgsOptions): Promise<Canvas.Assignments.Parameters> {
  const links = [];
  for (const item of assignment.LinkItems) {
    links.push(
      `<dt><a href="${item.UrlDisplay}">${item.ShortDescription}</a></dt>`
    );
  }

  const files = [];
  if (Preferences.files()) {
    for (const item of assignment.DownloadItems) {
      const file = await Canvas.Files.upload({
        course,
        localFilePath: path.resolve(
          path.dirname(IndexFile.path()),
          (item.DownloadUrl as unknown as Annotated).localPath.replace(
            /^\//,
            ''
          )
        ),
        args: Files.toCanvasArgs({ file: item })
      });
      // FIXME confirm whether or not these are absolute URLs or just paths
      files.push(
        `<dt><a class="instructure_file_link inline_disabled" title="${file.filename}" href="/courses/${course.id}/files/${file.id}?wrap=1" target="_blank" rel="noopener" data-api-endpoint="/api/v1/courses/${course.id}/files/${file.id}" data-api-returntype="File">${file.filename}</a></dt><dd>${item.ShortDescription}</dd>`
      );
    }
  }
  const args: Canvas.Assignments.Parameters = {
    // FIXME strip HTML from assignment.ShortDescription
    /* FIXME use only first line of assignment.ShortDescription
     *   move the rest to the start of assignment[description]
     */
    'assignment[name]': assignment.ShortDescription,
    'assignment[position]': order,
    'assignment[due_at]': new Date(assignment.DueDate).toISOString(),

    'assignment[description]': `<div>${assignment.LongDescription}</div>${definitionList(links)}${definitionList(files)}`,
    'assignment[published]': assignment.PublishInd,
    'assignment[assignment_group_id]': assignmentGroups.find(
      (assignmentGroup) => assignmentGroup.name == assignment.type
    )?.id,
    'assignment[submission_types]': []
  };
  if (assignment.OnPaperSubmission) {
    args['assignment[submission_types]']?.push('on_paper');
  }
  if (assignment.DropboxInd) {
    args['assignment[submission_types]']?.push('online_upload');
  }
  if (assignment.MaxPoints) {
    args['assignment[points_possible]'] = assignment.MaxPoints;
  } else {
    args['assignment[omit_from_final_grade]'] = true;
    args['assignment[hide_in_gradebook]'] = true;
  }

  return args;
}
