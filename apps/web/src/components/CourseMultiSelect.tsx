import { Search, X } from "lucide-react";
import { useMemo, useState, type AriaAttributes } from "react";
import { matchesListSearch, sortListRows } from "../services/listQuery";
import type { CourseSummary } from "../services/types";
import { useComboboxNavigation } from "./useComboboxNavigation";

export function CourseMultiSelect({
  courses,
  disabled = false,
  id,
  onChange,
  selectedIds,
  "aria-invalid": ariaInvalid,
  "aria-describedby": describedBy,
  "aria-required": ariaRequired
}: {
  courses: CourseSummary[];
  disabled?: boolean;
  id: string;
  onChange: (courseIds: string[]) => void;
  selectedIds: string[];
} & Pick<AriaAttributes, "aria-invalid" | "aria-describedby" | "aria-required">) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [sort, setSort] = useState("code");
  const selectedCourses = selectedIds.map(courseId => courses.find(course => course.id === courseId)
    || { id: courseId, courseCode: "Saved course", courseName: "Outside the available catalogue", orgUnitId: "" });
  const filteredCourses = useMemo(() => sortListRows(courses.filter(course => !selectedIds.includes(course.id))
    .filter(course => matchesListSearch(query, course.courseCode, course.courseName, course.academicYear)),
    course => sort === "name" ? course.courseName : sort === "year" ? course.academicYear : course.courseCode,
    sort === "year" ? "desc" : "asc", course => course.courseCode), [courses, query, selectedIds, sort]);

  function addCourse(course: CourseSummary) {
    onChange([...selectedIds, course.id]);
    setActiveIndex(-1); setQuery("");
    setIsOpen(true);
  }
  const { activeIndex, activeId, setActiveIndex, onKeyDown } = useComboboxNavigation({
    open: isOpen, setOpen: setIsOpen,
    optionIds: filteredCourses.map(course => `${id}-option-${course.id}`),
    onSelect: index => addCourse(filteredCourses[index])
  });

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
                disabled={disabled}
                onClick={() => onChange(selectedIds.filter((courseId) => courseId !== course.id))}
                type="button"
              >
                <X size={13} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="staff-search course-search" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setIsOpen(false); }}>
        <div className="search-box staff-search-input">
          <Search size={16} aria-hidden="true" />
          <input
            aria-label="Search courses"
            aria-invalid={ariaInvalid}
            aria-describedby={describedBy}
            aria-required={ariaRequired}
            aria-activedescendant={!disabled ? activeId : undefined}
            aria-autocomplete="list"
            aria-controls={isOpen && !disabled && courses.length ? `${id}-options` : undefined}
            aria-expanded={isOpen && !disabled && courses.length > 0}
            autoComplete="off"
            disabled={disabled || courses.length === 0}
            id={id}
            onChange={(event) => {
              setActiveIndex(-1); setQuery(event.target.value);
              setIsOpen(true);
            }}
            onFocus={() => { setIsOpen(true); setActiveIndex(-1); }}
            onKeyDown={onKeyDown}
            placeholder={courses.length ? "Type a course code or title" : "Course data not loaded"}
            role="combobox"
            type="text"
            value={query}
          />
        </div>
        {isOpen && !disabled ? <div className="picker-tools"><div className="picker-sort"><span>Sort by</span><select aria-label="Course results sort" value={sort} onChange={event => { setSort(event.target.value); setActiveIndex(-1); }}><option value="code">Course code</option><option value="name">Course title</option><option value="year">Academic year: newest first</option></select></div><span className="picker-results-count" role="status">{filteredCourses.length} {filteredCourses.length === 1 ? "result" : "results"}</span></div> : null}
        {isOpen && !disabled && courses.length > 0 ? (
          <div
            className="staff-search-results"
            id={`${id}-options`}
            role="listbox" aria-label="Course results"
          >
            {filteredCourses.length === 0 ? (
              <div className="staff-search-empty">No remaining courses match "{query.trim()}".</div>
            ) : filteredCourses.map((course, index) => (
              <button
                aria-selected={index === activeIndex}
                id={`${id}-option-${course.id}`}
                tabIndex={-1}
                className={`staff-search-result${index === activeIndex ? " is-active" : ""}`}
                key={course.id}
                onMouseDown={event => event.preventDefault()}
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
