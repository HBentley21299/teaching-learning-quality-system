import { useEffect, useMemo, useState, type AriaAttributes } from "react";
import { Search } from "lucide-react";
import { matchesListSearch, sortListRows } from "../services/listQuery";
import type { RoomSummary } from "../services/types";
import { useComboboxNavigation } from "./useComboboxNavigation";

type RoomSearchSelectProps = {
  id: string;
  onChange: (roomCode: string) => void;
  rooms: RoomSummary[];
  value: string;
} & Pick<AriaAttributes, "aria-invalid" | "aria-describedby" | "aria-required">;

export function RoomSearchSelect({ id, onChange, rooms, value, "aria-invalid": ariaInvalid, "aria-describedby": describedBy, "aria-required": ariaRequired }: RoomSearchSelectProps) {
  const selectedRoom = rooms.find((room) => room.roomCode.toLocaleLowerCase() === value.toLocaleLowerCase());
  const [query, setQuery] = useState(selectedRoom ? formatRoom(selectedRoom) : value);
  const [isOpen, setIsOpen] = useState(false);
  const [sort, setSort] = useState("code");
  const optionsId = `${id}-options`;

  useEffect(() => {
    if (!isOpen) setQuery(selectedRoom ? formatRoom(selectedRoom) : value);
  }, [isOpen, selectedRoom?.roomCode, selectedRoom?.buildingName, value]);

  const filteredRooms = useMemo(() => sortListRows(rooms.filter(room => matchesListSearch(query, room.roomCode, room.buildingName)),
    room => sort === "building" ? room.buildingName : room.roomCode, "asc", room => room.roomCode), [query, rooms, sort]);

  function selectRoom(room: RoomSummary) {
    setQuery(formatRoom(room));
    setIsOpen(false);
    onChange(room.roomCode);
  }
  const { activeIndex, activeId, setActiveIndex, onKeyDown } = useComboboxNavigation({
    open: isOpen, setOpen: setIsOpen,
    optionIds: filteredRooms.map(room => `${optionsId}-${room.id}`),
    onSelect: index => selectRoom(filteredRooms[index])
  });

  return (
    <>
      <div className="staff-search form-staff-search room-search-select" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setIsOpen(false); }}>
        <div className="search-box staff-search-input">
          <Search size={16} aria-hidden="true" />
          <input
            aria-label="Room"
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            aria-controls={isOpen ? optionsId : undefined}
            aria-describedby={[`${id}-help`, describedBy].filter(Boolean).join(" ")}
            aria-invalid={ariaInvalid}
            aria-required={ariaRequired}
            aria-expanded={isOpen}
            autoComplete="off"
            id={id}
            onChange={(event) => {
              setActiveIndex(-1); setQuery(event.target.value);
              setIsOpen(true);
              onChange("");
            }}
            onFocus={() => { setIsOpen(true); setActiveIndex(-1); if (value) setQuery(""); }}
            onKeyDown={onKeyDown}
            placeholder="Type a room code or room name"
            role="combobox"
            type="text"
            value={query}
          />
        </div>

        {isOpen ? <div className="picker-tools"><div className="picker-sort"><span>Sort by</span><select aria-label="Room results sort" value={sort} onChange={event => { setSort(event.target.value); setActiveIndex(-1); }}><option value="code">Room code</option><option value="building">Building name</option></select></div><span className="picker-results-count" role="status">{filteredRooms.length} {filteredRooms.length === 1 ? "result" : "results"}</span></div> : null}
        {isOpen ? (
          <div className="staff-search-results" id={optionsId} role="listbox" aria-label="Room results">
            {filteredRooms.length === 0 ? (
              <div className="staff-search-empty">No active rooms match "{query.trim()}".</div>
            ) : (
              filteredRooms.map((room, index) => (
                <button
                  aria-selected={index === activeIndex}
                  id={`${optionsId}-${room.id}`}
                  tabIndex={-1}
                  className={`staff-search-result${index === activeIndex ? " is-active" : ""}`}
                  key={room.id}
                  onMouseDown={event => event.preventDefault()}
                  onClick={() => selectRoom(room)}
                  role="option"
                  type="button"
                >
                  <strong>{room.roomCode}</strong>
                  <span>{room.buildingName}</span>
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>
      <small id={`${id}-help`}>
        {selectedRoom
          ? `Selected: ${selectedRoom.roomCode} - ${selectedRoom.buildingName}`
          : value ? `Saved room: ${value}. This room is outside the available list and is retained until replaced.` : "Start typing, then select an active room from the results."}
      </small>
    </>
  );
}

function formatRoom(room: RoomSummary) {
  return `${room.roomCode} - ${room.buildingName}`;
}
