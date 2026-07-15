import { Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { CourseSummary } from "../services/types";

export function CourseMultiSelect({
  courses,
  disabled = false,
  id,
  onChange,
  selectedIds
}: {
  courses: CourseSummary[];
  disabled?: boolean;
  id: string;
  onChange: (courseIds: string[]) => void;
  selectedIds: string[];
}) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const selectedCourses = selectedIds
    .map((courseId) => courses.find((course) => course.id === courseId))
    .filter((course): course is CourseSummary => Boolean(course));
  const filteredCourses = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return courses
      .filter((course) => !selectedIds.includes(course.id))
      .filter((course) => !normalizedQuery || [course.courseCode, course.courseName, course.academicYear ?? ""]
        .some((value) => value.toLocaleLowerCase().includes(normalizedQuery)))
      .slice(0, 10);
  }, [courses, query, selectedIds]);

  function addCourse(course: CourseSummary) {
    onChange([...selectedIds, course.id]);
    setQuery("");
    setIsOpen(true);
  }

  return (
    <div className="course-multi-select">
      {selectedCourses.length > 0 ? (
        <div className="course-chip-list" aria-label="Selected courses">
          {selectedCourses.map((course) => (
            <span className="course-chip" key={course.id}>
              <strong>{course.courseCode}</strong>
              {course.courseName}
              <button
                aria-label={`Remove ${course.courseCode}`}
                onClick={() => onChange(selectedIds.filter((courseId) => courseId !== course.id))}
                type="button"
              >
                <X size={13} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="staff-search course-search">
        <div className="search-box staff-search-input">
          <Search size={16} aria-hidden="true" />
          <input
            aria-autocomplete="list"
            aria-controls={`${id}-options`}
            aria-expanded={isOpen}
            autoComplete="off"
            disabled={disabled || courses.length === 0}
            onBlur={() => setIsOpen(false)}
            onChange={(event) => {
              setQuery(event.target.value);
              setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && filteredCourses.length > 0) {
                event.preventDefault();
                addCourse(filteredCourses[0]);
              }
              if (event.key === "Escape") {
                setIsOpen(false);
              }
            }}
            placeholder={courses.length ? "Type a course code or title" : "Course data not loaded"}
            role="combobox"
            type="text"
            value={query}
          />
        </div>
        {isOpen && courses.length > 0 ? (
          <div
            className="staff-search-results"
            id={`${id}-options`}
            onMouseDown={(event) => event.preventDefault()}
            role="listbox"
          >
            {filteredCourses.length === 0 ? (
              <div className="staff-search-empty">No remaining courses match "{query.trim()}".</div>
            ) : filteredCourses.map((course) => (
              <button
                className="staff-search-result"
                key={course.id}
                onClick={() => addCourse(course)}
                role="option"
                type="button"
              >
                <strong>{course.courseCode}</strong>
                <span>{course.courseName}</span>
                {course.academicYear ? <small>{course.academicYear}</small> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
