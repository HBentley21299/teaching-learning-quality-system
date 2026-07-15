import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { RoomSummary } from "../services/types";

type RoomSearchSelectProps = {
  id: string;
  onChange: (roomCode: string) => void;
  rooms: RoomSummary[];
  value: string;
};

export function RoomSearchSelect({ id, onChange, rooms, value }: RoomSearchSelectProps) {
  const selectedRoom = rooms.find((room) => room.roomCode.toLocaleLowerCase() === value.toLocaleLowerCase());
  const [query, setQuery] = useState(selectedRoom ? formatRoom(selectedRoom) : "");
  const [isOpen, setIsOpen] = useState(false);
  const optionsId = `${id}-options`;

  useEffect(() => {
    if (selectedRoom) {
      setQuery(formatRoom(selectedRoom));
    } else if (!isOpen) {
      setQuery("");
    }
  }, [isOpen, selectedRoom]);

  const filteredRooms = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return rooms
      .filter((room) => !search || [room.roomCode, room.buildingName].some((candidate) => candidate.toLocaleLowerCase().includes(search)))
      .sort((left, right) => left.roomCode.localeCompare(right.roomCode))
      .slice(0, 10);
  }, [query, rooms]);

  function selectRoom(room: RoomSummary) {
    setQuery(formatRoom(room));
    setIsOpen(false);
    onChange(room.roomCode);
  }

  return (
    <>
      <div className="staff-search form-staff-search room-search-select">
        <div className="search-box staff-search-input">
          <Search size={16} aria-hidden="true" />
          <input
            aria-autocomplete="list"
            aria-controls={optionsId}
            aria-expanded={isOpen}
            autoComplete="off"
            id={id}
            onBlur={() => setIsOpen(false)}
            onChange={(event) => {
              setQuery(event.target.value);
              setIsOpen(true);
              onChange("");
            }}
            onFocus={() => setIsOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && filteredRooms.length > 0) {
                event.preventDefault();
                selectRoom(filteredRooms[0]);
              }

              if (event.key === "Escape") {
                setIsOpen(false);
              }
            }}
            placeholder="Type a room code or room name"
            role="combobox"
            type="text"
            value={query}
          />
        </div>

        {isOpen ? (
          <div className="staff-search-results" id={optionsId} onMouseDown={(event) => event.preventDefault()} role="listbox">
            {filteredRooms.length === 0 ? (
              <div className="staff-search-empty">No active rooms match "{query.trim()}".</div>
            ) : (
              filteredRooms.map((room) => (
                <button
                  aria-selected={room.roomCode.toLocaleLowerCase() === value.toLocaleLowerCase()}
                  className="staff-search-result"
                  key={room.id}
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
      <small>
        {selectedRoom
          ? `Selected: ${selectedRoom.roomCode} - ${selectedRoom.buildingName}`
          : "Start typing, then select an active room from the results."}
      </small>
    </>
  );
}

function formatRoom(room: RoomSummary) {
  return `${room.roomCode} - ${room.buildingName}`;
}
